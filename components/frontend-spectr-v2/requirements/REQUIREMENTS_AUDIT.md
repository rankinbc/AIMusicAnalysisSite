# Requirements: Design Audit Synthesis

> Cross-page synthesis of the per-page audits in `page-audits/`. Identifies what ships in v1, what defers, what cuts, and the cross-cutting backend changes that unblock multiple pages at once.
>
> **Companion docs:** `REQUIREMENTS_CAPABILITIES.md` (what we have today), `REQUIREMENTS_ARCHITECTURE.md` (locked technical decisions).
>
> **Authority:** Revision 2 (below) supersedes Revision 1 wherever they conflict. R1 stays for history.

---

# Revision 2 — 2026-05-17

## What changed since Revision 1

Two clarifications and one design-file update batch landed:

1. **"Apply preset" is NOT a DAW export.** It's an in-app A/B audition: clicking the button on a Coach finding navigates to the Listen page with the verdict's `fix.steps[]` already loaded into the ToolsRail so the producer can *hear* the proposed fix before applying it in their DAW. Listen ToolsRail is therefore real Web Audio DSP, not placeholder.

2. **`fix.steps[]` is the wire-format contract between Coach and Listen.** The verdict shape extension (`body, metric_line, chart_type, impact, confidence, fix.steps[], preset_name`) we discussed in R1 isn't just for display — it's the payload format the ToolsRail consumes.

3. **4 design files updated**, all driven by "audio tools on someone else's track":
   - `discover.jsx` — `PublicListenView` got ToolsRail (real DSP), public comment thread with timestamp-pin scrubbing, ☆/★ bookmark button, anonymous-publish toggle in PublishModal
   - `profile.jsx` — new Bookmarks tab + `BookmarkCard`
   - `app.jsx` — bookmarks state + cross-page nav callbacks; `songContext` + `onBackToSong` passed to Results
   - `results.jsx` — header gained optional "← {song} · all versions" back-link

This expands the social surface. Comments + bookmarks are no longer a "Phase 3 share-link feedback primitive" — they're now a v1.5 layer that the audit recommends shipping against the existing `share_token` infrastructure, with the same tables ready to extend for Discover later (polymorphic target pattern).

---

## Headline shifts vs. Revision 1

- **Listen page verdict upgrades**: 🟡 Implement w/ placeholders → 🟡 Implement w/ real DSP (subset). EQ, Compressor, Width, Loop, Phase Scope, Loudness meter all become real Web Audio in v1. Saturator, Limiter, Pitch, "Save chain as preset" stay deferred.
- **"Apply preset" is uncut**. Removed from universal-cuts. Real interaction in Coach.
- **Discover full feed stays 🟠 DEFER**, but **comments + bookmarks ship in v1.5** against the share-link primitive via a polymorphic schema that later supports Discover for free.
- **Profile Bookmarks tab** rides with v1.5 (when comments/bookmarks ship), not with the full Discover deferment.
- **App shell verdict: ✅ IMPLEMENT AS-IS** — routing collapses cleanly into TanStack Router; only one BFF addition needed (see below).
- **One small backend additive**: `/jobs/{id}/results` must include `song_id` + `song_name` when the job is bound to a SongVersion. This unblocks Results back-link AND lets TanStack Router encode the song relationship in the URL (`/songs/$songId/results/$jobId`), eliminating the `songContext` prop entirely.

---

## Updated page verdicts

| Page | Verdict | Headline reason | Phase |
|---|---|---|---|
| **Results** | 🟡 Implement w/ placeholders | + back-link, + Apply Preset is real; small `/jobs/{id}/results` envelope addition | 1 |
| **Listen** | 🟡 Implement w/ real DSP (subset) | EQ/Comp/Width/Loop/Scope/Loudness are real Web Audio; Sat/Limit/Pitch deferred | 1 |
| **Library** | 🟡 Implement w/ placeholders | unchanged from R1 | 1 |
| **Profile (Unit A)** | 🟡 Implement w/ placeholders | identity + library embed + settings | 1 |
| **Coach (verdict list)** | 🟡 Implement w/ placeholders | needs locked verdict shape revision | 1 |
| **App shell** | ✅ Implement as-is | TanStack Router + `_app/_public` layouts; one tiny BFF addition | 1 |
| **Coach (chat panel)** | 🟠 Defer | greenfield streaming endpoint | 3 |
| **Profile (Unit B — References)** | 🟠 Defer | marquee feature, separate workstream | 2 |
| **Compare** | 🟠 Defer | blocked on References | 2 |
| **Profile (Unit C — Bookmarks)** | 🟡 v1.5 | rides with comments+bookmarks against share-link | 1.5 |
| **Comments + Bookmarks (share-link)** | 🟡 v1.5 | polymorphic schema ready for Discover later | 1.5 |
| **Discover (full feed + public profiles + ToolsRail-on-public)** | 🟠 Defer | requires public audio streaming + cold-start audience | 4 (post-launch) |
| **Discover (Publish modal)** | 🟡 Re-skin as ShareSongModal | reuses existing `share_token`; zero backend work | 1 |

---

## Cross-cutting changes — Revision 2

R1 listed five. Revision 2 keeps four of them, drops nothing, and adds three.

### Kept from R1 (still load-bearing)

1. **Verdict shape extension** (R1 §1) — locked. The new fields are now also the wire-format contract for Apply Preset, so this is more load-bearing than R1 framed it.
2. **Waveform peaks pre-compute** (R1 §2) — unchanged.
3. **Audio streaming endpoint** (R1 §3) — unchanged for owner audio. **NEW caveat below** for public/share-link audio.
4. **Identity fields on `users`** (R1 §4) — unchanged.
5. **Small schema additions** (R1 §5) — unchanged.

### New in Revision 2

6. **`/jobs/{id}/results` envelope expansion** (unblocks Results back-link, app routing, future cross-page nav)

   When the job is bound to a SongVersion, include:
   ```json
   {
     "job_id": "...",
     "final_json": { ... },
     "share_token": "...",
     "song_id": "...",    // NEW — only present when version_id is set
     "song_name": "...",  // NEW — only present when version_id is set
     "version_id": "..."  // NEW — already exists in DB; surface in envelope
   }
   ```

   The data already exists (`upload_jobs.version_id → song_versions.song_id → songs.name`). Pure response-shape change in the BFF. **Effort: trivial.**

7. **Polymorphic comments + bookmarks schema** (unblocks v1.5 feedback layer, futureproofs Discover)

   Per the discover re-audit's recommendation, design the tables to target *either* a share-link OR a published track, with a CHECK constraint that exactly one is set. v1.5 ships against `share_token` only; Discover later flips on the `published_track_id` arm without any schema change.

   ```sql
   CREATE TABLE track_comments (
     id                      UUID PRIMARY KEY,
     target_share_token      TEXT REFERENCES analysis_results(share_token),
     target_published_track  UUID REFERENCES published_tracks(id),   -- null in v1.5
     author_user_id          UUID REFERENCES users(id),              -- null = anonymous reviewer
     author_display_name     TEXT,                                   -- captured on submit
     timestamp_seconds       REAL,                                   -- null = general; else pinned to waveform
     body                    TEXT NOT NULL,
     created_at              TIMESTAMPTZ DEFAULT NOW(),
     deleted_at              TIMESTAMPTZ,                            -- soft-delete for moderation
     CHECK (
       (target_share_token IS NOT NULL AND target_published_track IS NULL)
       OR (target_share_token IS NULL AND target_published_track IS NOT NULL)
     )
   );

   CREATE TABLE track_bookmarks (
     user_id                 UUID REFERENCES users(id),
     target_share_token      TEXT REFERENCES analysis_results(share_token),
     target_published_track  UUID REFERENCES published_tracks(id),
     created_at              TIMESTAMPTZ DEFAULT NOW(),
     CHECK (
       (target_share_token IS NOT NULL AND target_published_track IS NULL)
       OR (target_share_token IS NULL AND target_published_track IS NOT NULL)
     ),
     UNIQUE (user_id, target_share_token, target_published_track)
   );
   ```

   `published_tracks` doesn't exist in v1.5 — the FK is nullable + the CHECK enforces v1.5 use the `target_share_token` arm. When Discover ships, create `published_tracks`, set the FK, no migration of existing rows needed.

   **Effort: M (day or two)** for migration + BFF endpoints + frontend wiring.

8. **Routing collapses `songContext` prop** (zero backend work; pure frontend mechanics)

   Per app-shell audit: route Results as `/songs/$songId/results/$jobId`. The song id is in the URL, the back-link is `<Link to="../">` or `<Link to="/songs/$songId">`. No prop drilling. The `songContext` design surfaces in app.jsx → results.jsx becomes a routing pattern, not a state-management pattern.

---

## v1.5 layer — comments + bookmarks on share-links

This is genuinely new since R1. R1 said share-link feedback was Phase 3; R2 says ship a minimal feedback layer in v1.5 because the design files have already incorporated the affordances (timestamped comments, bookmarks) and the polymorphic schema makes it cheap to do.

### v1.5 scope

**Frontend:**
- Anonymous reviewer page at `/r/{share_token}` (or `/r/$shareToken` in TanStack Router):
  - WaveSurfer.js player with pre-computed peaks
  - Click any point on the waveform → drop a timestamped comment pin
  - Free-text comment input
  - Optional reviewer display name (anonymous-ok)
  - Read-only verdict list if owner enabled "Show analysis publicly" on the share
- Producer dashboard: comments view on the report page (showing all timestamped comments)
- Profile Bookmarks tab works for both share-link bookmarks AND (later) Discover bookmarks via the polymorphic target.

**Backend (BFF):**
- `GET /api/share/{token}` — returns track metadata + waveform peaks + (optional) verdicts; no auth
- `POST /api/share/{token}/comments` — body `{timestamp_seconds, body, author_display_name}`; no auth required, captures IP hash for spam mitigation
- `GET /api/share/{token}/comments` — paginated; no auth
- `POST /api/me/bookmarks` — body `{target_share_token}` (or later `{target_published_track}`)
- `DELETE /api/me/bookmarks/{id}`
- `GET /api/me/bookmarks` — paginated list with joined track metadata
- Auth check on writes to the producer's own report: dismiss comments, soft-delete, etc.

**Backend (Python worker):** nothing new.

**v1.5 cuts vs. discover audit recommendations:**
- ❌ Cut anonymous-publish flag (no Discover yet)
- ❌ Cut comment moderation queue (use soft-delete + producer-side hide button only)
- ❌ Cut comment reply threads (flat thread in v1.5; reply threading is v2)
- ❌ Cut email notifications on new comments (TanStack Query refetch on focus is enough; email is v2)
- ❌ Cut comment rate-limiting beyond basic IP-hash per-hour cap (no hCaptcha until we see spam)

### Why v1.5 not v1

Comments + bookmarks introduce moderation considerations, IP hashing for spam (GDPR scope), and an additional set of routes + tables that don't unblock the core "I want a producer-grade analysis" value loop. Ship the core app first (v1 = the seven pages), then v1.5 adds the social layer two-three weeks later once the core is stable.

If you'd rather collapse v1 + v1.5 into one ship, the schema work is the same — just bigger blast radius for the first release.

---

## Updated universal cuts list

R1 had a long list. R2 reverses two and re-confirms the rest.

**Reversed (now in v1 / v1.5):**
- ~~"Apply preset" / DAW export~~ → **"Apply preset" is real**, navigates Coach → Listen with `fix.steps[]` loaded. (DAW export — exporting an `.adv` file — stays cut.)
- ~~Listen ToolsRail (cut all 8 tiles)~~ → **EQ, Compressor, Width, Loop, Phase Scope, Loudness meter ship as real Web Audio DSP**. Saturator, Limiter (no lookahead WASM), Pitch/tempo, Save-chain-as-preset stay deferred.

**Still cut (universal across v1 + v1.5):**
- "Export PDF" (any page) — no PDF rendering infra
- `track.tranceDNA.parts[]` — decorative; no pipeline support
- Track DNA card on Listen (Mood / Energy / Vocals classifiers) — no classifiers exist
- Procedural fake spectrum (`spectrum.jsx`) — replace with WaveSurfer analyzer or omit
- ToolsRail Saturator, Limiter, Pitch/tempo
- "Save chain as preset" — defer to v1.x
- Plays counter (Library, Profile, Discover) — no event tracking
- Plan tier + quotas (Profile) — hardcode "Studio · 50/mo" static
- Snooze button — client-side only (sessionStorage), no DB column
- "Apply all suggested adjustments" (Compare) — no DAW
- Filmmaker-coded copy ("Sync-cleared") — wrong audience
- Reference URL ingest (Spotify/YouTube/SoundCloud) — defer; references = file-upload only
- Bulk URL paste — defer
- Reference sets — defer to v1.x (flat list in v1)
- "View full diff →" page (Library ActiveDeltaCard)
- `OverviewTab` / `AITab` / `StreamingTab` / `VerdictHero` in results.jsx — design debris (confirm with designer, then delete)
- `tweaks-panel.jsx` — design-time edit harness; do not port
- Discover full feed, public profiles, plays, mood/license taxonomy, ToolsRail-on-public-tracks, anonymous-publish — all defer to post-v1.5 (Phase 4)
- Coach chat panel — defer to Phase 3 (after v1.5)

---

## Updated phased shipping plan

### Phase 1 — Core app (6-8 weeks of evenings, unchanged from R1)

Goal: producer can register, upload audio, see analysis, run AI specialists, manage their library, write listening notes, share a read-only report link, AB-audition fixes via Apply Preset.

Added since R1:
- `/jobs/{id}/results` envelope now includes `song_id`, `song_name`, `version_id` when version-bound
- Real Web Audio DSP on Listen ToolsRail (EQ / Comp / Width / Loop / Scope / Loudness meter)
- Apply Preset flow: Coach button → `<Link to="/listen/$versionId" search={{ verdict_id }}>` → Listen reads `verdict_id` search param → fetches `GET /reports/{job_id}/verdicts` → reads `fix.steps[]` → pre-populates ToolsRail
- TanStack Router `_app/*` (auth) + `_public/*` (anonymous) layouts

### Phase 1.5 — Comments + bookmarks against share-links (2-3 weeks)

Goal: producers can post a share-link to Discord/Twitter and receive timestamped feedback. Bookmarks accumulate on Profile.

- Polymorphic `track_comments` and `track_bookmarks` schema
- Anonymous reviewer page at `/r/$shareToken`
- BFF endpoints (`GET /api/share/{token}`, `POST /api/share/{token}/comments`, etc.)
- Profile Bookmarks tab (Unit C)
- Producer-side comment view on report page

### Phase 2 — References + Compare (3-4 weeks, unchanged from R1)

### Phase 3 — Coach chat (3-4 weeks, unchanged from R1)

### Phase 4 — Discover (post-launch, gated by Phase 1.5 success metrics)

Trigger: ≥30% of share-link recipients leave a comment within 14 days; ≥50% producer "useful" rating.

When Discover ships:
- `published_tracks` table comes online; existing `track_comments` + `track_bookmarks` start using the `target_published_track` arm
- Public audio streaming (CORS + Range for Web Audio consumption client-side)
- Public profiles with handles
- Plays / saves counters
- ToolsRail on public tracks (the same React component already shipped on Listen)
- Anonymous-publish flag

---

## Newly resolved product decisions

R1 surfaced 16 decisions. R2 resolves these explicitly:

| Decision | Resolution |
|---|---|
| Does v1 ship share-link feedback or only read-only report sharing? | **Yes — ship v1.5 comments + bookmarks on share-links** (2-3 weeks after v1) |
| Apply preset implementation | **Navigate Coach → Listen with `?verdict_id=<id>`** in URL search params; Listen fetches verdict and reads `fix.steps[]` (cleaner than URL-encoding the entire payload — no length limit concerns) |
| Listen tool scope | **EQ / Comp / Width / Loop / Scope / Loudness meter ship real**; Sat / Limit / Pitch defer |
| `songContext` prop on Results | **Eliminated**: encode in URL via TanStack Router route `/songs/$songId/results/$jobId` |
| Bookmarks storage | **TanStack Query** + new BFF endpoint trio + `track_bookmarks` table (polymorphic) |
| Comment schema target | **Polymorphic** — share_token in v1.5, published_track in Phase 4 |
| Density tweak (visualizer, viewMode) from tweaks-panel | **Density** becomes a real user setting; **visualizer + viewMode** defer to fixed defaults |
| `/jobs/{id}/results` envelope | **Add `song_id` + `song_name` + `version_id`** when version-bound |

---

## Newly surfaced product decisions

These came out of the re-audit and need a call:

| Decision | Default recommendation |
|---|---|
| Anonymous reviewer page: require display name, or fully anonymous? | Optional display name; default "Anonymous reviewer #{n}" if not provided |
| Comment pin granularity: nearest-second or millisecond? | Nearest 0.5s (cleaner UI; matches WaveSurfer's `Region` API) |
| Bookmark cap per user? | None in v1.5; revisit at 1000 bookmarks/user observed |
| Comment cap per share-link? | Soft cap at 200 per share with "load more" UX |
| Comment rate-limit | 5 comments/hour per IP hash; surface as 429 if exceeded |
| Producer-side moderation UI | One-click "hide from my view" button (uses `track_comments.deleted_at`); no admin queue in v1.5 |
| IP hash retention | 90 days; documented in privacy page |
| Apply Preset: include "automation" steps as ToolsRail UI annotations? | Yes — render `automation`/`arrangement`/`production`/`check` kinds as read-only notes in the preset's "applied" panel; only `plugin`/`fx`/`target` actually modify the audio graph |
| What if Apply Preset is clicked on a verdict for a track that's not the currently-loaded one? | Navigate to the right version's Listen page first, then load the preset |
| Listen `tweak.density` setting | Real user setting (server-stored); falls back to "regular" |
| Public profile handle reservation | Reserve all handles at registration via auto-seed (`email.split('@')[0]` + suffix on conflict); editable in Settings later |

---

## What this synthesis does NOT update

- The original **Revision 1** content below remains accurate for pages and decisions it covers. Most of R1 still holds; R2 only updates the things that materially changed.
- `REQUIREMENTS_CAPABILITIES.md` describes **today's backend state** — unchanged; the new fields described above are decisions for the rewrite, not claims about what exists now.
- `REQUIREMENTS_ARCHITECTURE.md` — unchanged. The polymorphic comments/bookmarks schema fits cleanly under the BFF-owns-table convention. Routing decisions in app-shell audit align with the locked frontend stack (TanStack Router was already the pick).

---

## Phase 1 effort estimate (R2)

R1 said "6-8 weeks of evenings". R2 adds:
- `/jobs/{id}/results` envelope (~10 min)
- TanStack Router file-based routes (~half a day)
- Web Audio DSP for 6 tools (~3-4 days; standard Web Audio API, no novel work)
- Apply Preset wiring (~half a day, mostly the verdict→ToolsRail param mapping table)

Net: 7-8 weeks of evenings for Phase 1 (vs R1's 6-8). Phase 1.5 adds 2-3 weeks. Phase 2-3-4 cadence unchanged.

---

# Revision 1 — original synthesis (preserved for history)

> Everything below this line is the original synthesis. R2 above supersedes wherever they conflict.

---

## TL;DR

- **5 of 7 pages are buildable in v1 with placeholders.** Results, Listen, Library, Profile (small unit), and the verdict-list portion of Coach all work on top of the existing analysis pipeline with small backend deltas.
- **2 pages defer wholesale:** Discover (full community feed) and the chat panel in Coach. Both are greenfield. Replace Discover with a re-skinned "Share song" modal sitting on the existing `share_token` primitive.
- **Compare is buildable but BLOCKED on the references library**, which is the marquee feature of the Profile page's deferred unit. References + Compare ship together as Phase 2.
- **One coordinated backend change unlocks 3+ pages:** revising the verdict-pipeline prompt contract to emit richer fields (`body`, `metricLine`, `chartType`, `impact`, `confidence`, structured `fix.steps[]`, `presetName`).
- **One worker addition unlocks Listen and future audio everywhere:** BBC `audiowaveform` pre-compute as a Celery/dramatiq task, output stored as peaks JSON.
- **One ASP.NET Core endpoint unlocks scrub-able audio:** `GET /api/versions/{id}/audio` with `enableRangeProcessing: true`. Native; no new infrastructure.

---

## Page verdicts at a glance

| Page | Verdict | Headline reason | Phase |
|---|---|---|---|
| **Results** | 🟡 Implement with placeholders | ~75% of data exists; small pipeline gaps (short-term LUFS, clarity, dimension scores) | 1 |
| **Listen** | 🟡 Implement with placeholders | Core works; cut tool chain, Track DNA, similar-tracks | 1 |
| **Library** | 🟡 Implement with placeholders | Iteration arc fully buildable; cut plays + Publish-to-Discover | 1 |
| **Profile (Unit A)** | 🟡 Implement with placeholders | Header + Library embed + basic settings ship now | 1 |
| **Coach (verdict list)** | 🟡 Implement with placeholders | Works with prompt-contract revision (no chat yet) | 1 |
| **Coach (chat panel)** | 🟠 Defer | Greenfield streaming endpoint; not blocking | 3 |
| **Profile (Unit B — References)** | 🟠 Defer | New table + ingest pipeline; marquee feature but standalone workstream | 2 |
| **Compare** | 🟠 Defer | Blocked on References | 2 |
| **Discover (full feed)** | ❌ Cut for v1 | No public-graph backend; Phase-1 social is share-link, not feed | 4 (post-launch) |
| **Discover (Publish modal)** | 🟡 Re-skin as ShareSongModal | Reuses existing `share_token` primitive; zero backend work | 1 |

---

## Cross-cutting changes (do these once, unlock multiple pages)

These are the high-leverage backend changes that show up in multiple audits. Doing them up front is cheaper than retrofitting per-page.

### 1. Verdict shape extension (unlocks Results, Coach, Library "active delta")

The `COACH_FINDINGS` mock shape is materially richer than today's `Verdict` Pydantic model. Bump the specialist prompt contract once to add:

- `impact: "high" | "med" | "low"` (mapped from severity + priority_score band; LLM emits)
- `confidence: float (0–1)` (LLM self-report; optional but cheap)
- `body: string` (2–3 sentence long-form; today's `summary` is shorter)
- `metric_line: string` (single tagline of evidence values; e.g. `"-11.2 LUFS · -14 SPOTIFY · 5.4 LU DYN"`)
- `chart_type: "lufs" | "frequency" | "eq-curve" | "sidechain" | "arrangement" | "stems" | null`
- `fix.steps: [{ kind, where, what, from, to }]` (structured DSP recipe; today's `fix.dsp_chain` is similar but typed differently)
- `preset_name: string | null` (optional human label like `"Spotify-safe master"`)

`rank` is derived (sort by `priority_score` desc), not stored.
Persona metadata (`SPECIALIST_PERSONAS`: color, glyph, label) stays a frontend constant — do NOT push into the DB.

**Effort:** M (days). Single Pydantic schema bump + prompt edits across 26 specialist `.md` files. Tests round-trip a sample payload through both Python serializer and C# DTO.

### 2. Waveform peaks pre-compute (unlocks Listen, Compare, future Discover)

Add a `precompute_waveform_peaks(job_id)` dramatiq task triggered after audio decode succeeds. Uses BBC's `audiowaveform` CLI:

```bash
audiowaveform -i source.wav -o peaks.json --pixels-per-second 20 --bits 8
```

Store at `peaks/{job_id}.json` via `IFileStorage`. WaveSurfer.js v7 consumes pre-rendered peaks. Without this, WaveSurfer decodes the whole audio file client-side — slow on mobile and on tracks > 5 min.

**Effort:** S (hours). Task definition + Docker image addition (`audiowaveform` binary).

### 3. Audio streaming endpoint (unlocks Listen, Compare, future share-link feedback)

```csharp
app.MapGet("/api/versions/{versionId:guid}/audio", async (
    Guid versionId, IFileStorage storage, ClaimsPrincipal user, /*…*/) =>
{
    var v = await db.SongVersions.FindAsync(versionId);
    if (v is null || v.Song.UserId != user.UserId()) return Results.NotFound();
    var stream = await storage.OpenReadAsync(v.FilePath);
    return Results.File(stream, v.ContentType, enableRangeProcessing: true);
});
```

The `enableRangeProcessing: true` flag is the magic — without it, `<audio>` plays but cannot scrub.

**Effort:** S (hours). Single endpoint + auth check. ASP.NET Core handles ranges natively.

### 4. Identity fields on `users` (unlocks Profile, future Discover, future share-link)

Even if Discover defers, add these columns now to future-proof URLs and avoid a v1 migration:

```sql
ALTER TABLE users ADD COLUMN handle          text UNIQUE;  -- 3-32 chars, [a-z0-9_]
ALTER TABLE users ADD COLUMN display_name    text;
ALTER TABLE users ADD COLUMN bio             text;
ALTER TABLE users ADD COLUMN avatar_hue      smallint;     -- 0-359
ALTER TABLE users ADD COLUMN banner_hue      smallint;
ALTER TABLE users ADD COLUMN accent          text;         -- enum: cyan|violet|orange|yellow|green|red
ALTER TABLE users ADD COLUMN public_link     text;
```

Auto-seed on register: handle = `email.split('@')[0]` + suffix on conflict; avatar_hue = random.

**Effort:** S (hours). One migration.

### 5. Small schema additions (each S effort, low coupling)

Independent additions; each unblocks exactly one page:

| Addition | Page | Note |
|---|---|---|
| `song_versions.is_current` (bool, partial unique idx per song_id) | Library | Producer pins canonical version; default newest |
| `session_notes` table `(id, version_id, user_id, t_seconds, text, pinned, …)` | Listen | Time-anchored private notes |
| Phase 1 metadata: `sample_rate`, `bit_depth` | Listen header chip ("WAV · 48 kHz · 24-bit") | cheap `soundfile.info()` add |
| `phase_results.duration_ms` | Results analysis tab pipeline timeline | Pipeline already logs elapsed; just persist |

---

## Pipeline output additions (all S–M, no schema changes — just new fields in `final_json`)

These are computed in the Python analysis pipeline. None require new tables.

| New field in `final_json` | Used by | Effort | How |
|---|---|---|---|
| `phase1.short_term_lufs` (array of LUFS-S values per N-second window) | Listen sparkline, Results loudness sparkline | S | `pyloudnorm.Meter.short_term_loudness` per-window pass |
| `phase1.sample_rate`, `phase1.bit_depth` | Listen header | S | `soundfile.info()` |
| `phase1.frequency_clarity` (0–100 spectral-flatness/centroid-stability proxy) | Results spectrum tab | S | Trivial formula |
| `phase1.frequency_label` (e.g. `"Bass-heavy"` / `"Bright"` / `"Balanced"`) | Results spectrum tab | S | Rule on band ratios |
| `phase7.arrangement_score` (0–100) | Results arrangement tab | S | Rule on violation count / section count |
| `dimensionScores[]` (6 category aggregates with sev + count) | Results dimension hero | S | Aggregate verdicts by `category` post-validation |
| `track.coachSummary` (totals) | Coach hero | S | Aggregate verdict counts |
| `track.analysisPipeline[]` (status tracker w/ unlock CTAs) | Results analysis tab | S | Derive from `phase_results` + `UploadJob.{stem_paths, reference_path, als_file_path}` |

---

## Universal cuts (apply across all pages)

These design elements are cut for v1, across the board. Confirms with designer if any are load-bearing.

- **"Apply preset" / DAW export** (any button that exports `.adv`/`.fxp`) — no DAW integration; render disabled with "Coming soon" tooltip, or hide.
- **"Export PDF"** (any button on Results, Coach, Compare) — no PDF rendering infra; render as print-stylesheet link if essential.
- **`track.tranceDNA.parts[]`** (decorative tag pills) — no pipeline support; cut.
- **Track DNA card** (Mood/Energy/Vocals classifiers) — no classifiers exist; cut on Listen.
- **Procedural fake spectrum** (`spectrum.jsx` sine-summation canvas) — replace with WaveSurfer's analyzer plugin reading real audio, or omit.
- **Tool chain DSP** (Listen page ToolsRail's EQ/Comp/Sat/Width/Limiter/Pitch) — placeholder only; ship as visual-only with "Preview only — not yet wired" labels, or hide entirely except Loop + Phase Scope (both feasible client-side).
- **Plays counter** (Library, Profile, Discover) — no event tracking; hide entirely.
- **Plan tier + quotas** (Profile) — hardcode "Studio · 50/mo" static text or hide. No billing model in v1.
- **Snooze button** on verdict cards — client-side only (sessionStorage); no DB column.
- **"Apply all suggested adjustments"** (Compare) — no DAW; hide.
- **Filmmaker-coded copy** ("Sync-cleared", "license for film/video") — wrong audience; replace with producer-friendly labels if shipped, or cut with feed.
- **Reference URL ingest** (Spotify/YouTube/SoundCloud import) — defer; references = file-upload only in v1.
- **Bulk URL paste** (Profile add-reference) — defer with URL import.
- **Reference sets** — defer to v1.x; ship flat reference list with genre chips.
- **"View full diff →"** (Library ActiveDeltaCard) — defer; render the inline mini-delta only.
- **`OverviewTab`, `AITab`, `StreamingTab`, `VerdictHero` in `results.jsx`** — design-iteration debris (defined but never routed); delete after designer confirmation.
- **`tweaks-panel.jsx`** — design-time edit-mode harness only; do not port to production.

---

## Per-page summary

### Results 🟡

**Build:** Yes, with placeholders. ~75% of data exists in `final_json`. The five tabs (AI Coach, Analysis, Spectrum, Reference, Arrangement) all map to existing pipeline outputs or trivial derivations. The Spectrum tab can read existing 7-band data; the Reference tab reads phase6 gaps; the Arrangement tab reads phase7.

**Backend deltas:** `phase1.short_term_lufs`, `phase1.frequency_clarity` + `_label`, `phase7.arrangement_score`, `phase_results.duration_ms`, `dimensionScores[]` aggregator. All S–M.

**Critical:** the `AICoachTab` component body is missing from `results.jsx` (line 18 references it, no implementation). Flag for designer before building — its shape is documented in `mock-data.jsx`'s `COACH_FINDINGS` array.

**Cuts:** `track.tranceDNA.parts[]`, `track.notes[]` (unused in any rendered tab), `OverviewTab`/`AITab`/`StreamingTab`/`VerdictHero` (defined but never routed), "Apply preset", "Export PDF", "Snooze" (use Dismiss only).

### Listen 🟡

**Build:** Yes, with placeholders. Core experience (play audio, see static analysis values, watch client-computed live meters via Web Audio AnalyserNode, write timestamped notes) is buildable.

**Backend deltas:** new `session_notes` table; new `GET /api/versions/{id}/audio` streaming route (S); pre-computed peaks (S); phase1 `sample_rate`/`bit_depth` (S).

**Cuts:** all 8 ToolsRail tools (placeholder DSP — keep only Loop + Phase Scope if anything), Track DNA card, Similar Tracks, Save chain preset, Loudness-match toggle, A/B switch (until tools are real).

**Trap:** mock animates fake LUFS-S/peak/correlation as if streamed from server — must be client-side Web Audio in real implementation. Don't pretend backend pushes these.

### Coach 🟡 + 🟠

**Build the verdict list (🟡):** prompt-contract revision (cross-cutting #1 above) unlocks rank/impact/confidence/body/metricLine/chartType/fix.steps/presetName. Roster grouping is a frontend constant. Per-specialist on-demand run already works via existing `POST /reports/{id}/verdicts/run/{slug}`.

**Defer the chat panel (🟠):** ship as `<CoachChat>` shell with "Coming soon — early access" overlay on input. Real implementation needs:
- New `POST /api/coach/{job_id}/chat` SSE endpoint
- Vercel AI SDK Data Stream protocol (newline-delimited tokens prefixed `0:`/`2:`/`e:`/`d:`)
- Anthropic Messages API streaming with context (`final_json` + `verdicts_payload` + last 2-3 prior versions)
- Decision: chat history persistence yes/no? Recommend sessionStorage in v1, DB in v1.x.

**Cuts:** "Apply preset" (no DAW), "Export PDF", chat tool-use (running specialists from chat — defer).

**Replaces v1.2's `VerdictsPanel.tsx`** — plan migration via feature flag during rollout.

### Discover ❌ (full feed) + 🟡 (Publish modal re-skin)

**Cut the full feed.** Per Claude Desktop research and Phase-1 social plan: shareable-link feedback works at N=1, a community feed requires liquidity. Discover assumes ~10 new routes and ~8 new tables before a single user benefits.

**Keep as `ShareSongModal`** — rename `PublishToDiscoverModal`. Drop genre/mood/license fields. Keep: version picker, optional title, optional description, "Show analysis publicly" toggle. Submitting copies the existing `/reports/share/{share_token}` URL to clipboard. **Zero backend work** — the `share_token` field already exists on `analysis_results` (migration 002) and the public report route already serves it.

**Placeholder for `/discover` route:** "Coming soon — share your mix with a tokenized link in the meantime" pointing to the share modal. Keeps nav slot consistent.

**Critical:** the filmmaker-coded license language ("Sync-cleared", "Royalty-free") in the mock is wrong audience — even if Discover ships later, language should be producer-friendly ("Free to use with credit", "Don't redistribute").

### Library 🟡

**Build:** Yes, fully. The iteration-arc UX (version arc sparkline, score delta, progress timeline, version compare card) is the centerpiece and is **fully buildable today**. All data exists in `songs`, `song_versions`, `analysis_results`, or is trivially derivable client-side.

**Backend deltas:** new `GET /api/songs?include=versions,latest_result` (replaces existing `/tracks`); new `POST /api/songs` (empty-song-first creation); extend `POST /uploads/` to accept `song_id`; new `POST /api/songs/{id}/versions/{v}/reanalyze`. New column `song_versions.is_current` (S). All ~S.

**Cuts:** `plays` counter, `★ Publish to Discover` button (point at ShareSongModal instead), Archive action UI (column already exists, defer modal), LLM-authored `ActiveDeltaCard` "verdict" prose (use templated string from numeric deltas), "Open full diff →" page.

**Cover-art hue:** derive deterministically from `hash(song.id) % 360` — no schema change.

### Profile 🟡 (Unit A) + 🟠 (Unit B — References)

**Ship Unit A in v1:** Profile header (identity), Library tab embed, Settings tab (display name / handle / email).

**Defer Unit B as Phase 2:** References library is the marquee feature — new table, ingest pipeline, URL downloader (deferred), reference sets (deferred to flat list). This is its own workstream.

**Backend deltas Unit A:** identity columns on `users` (cross-cutting #4); new routes `GET /api/me/profile`, `PATCH /api/me/profile`, `GET /api/me/stats`.

**Backend deltas Unit B (Phase 2):** new `references` table (~12 cols mirroring `REFERENCES` mock shape — title/artist/source/source_url/file_path/genre/bpm/key/duration_sec/lufs/true_peak/dynamic_range/width/correlation/tags JSONB/analyzed/used_count); `POST /api/references` (file); reuse existing `audio_analysis.run_pipeline` against reference audio.

**Cuts:** plan tier + quotas (hardcode "Studio" or hide), Activity timeline (or use UNION query over `upload_jobs`/`songs`/`song_versions` `created_at` for cheap v1 — no new event table), plays stat, "Manage plan", URL-based ref import (file upload only), bulk paste, reference sets (flat list only), "Default reference"/"Default streaming target" settings (defer; no enforcement plumbing), Export/Delete account (defer).

### Compare 🟡 (blocked on References)

**Build:** Yes, once References lands. The page is delta arithmetic over two already-analyzed `final_json`s. All metrics (LUFS, true peak, DR, width, correlation, 8-band frequency) exist for both sides after analysis. Until References ships, the page is buildable only against fixture data.

**Backend deltas:** one new endpoint `POST /api/compare` (or GET cacheable) that fetches two analyses + computes match score (one-page formula: weighted L2 distance across LUFS / DR / 8-band / width / correlation); `songs.default_reference_id` column for "Save as match target".

**Suggestions:** ship as deterministic delta-driven templates ("Push +N LUFS", "Cut bass −X%") rather than LLM-generated. Revisit once the verdict pipeline has a reference-aware prompt.

**Cuts:** "Export delta as PDF", "Apply all 3 suggested adjustments" (no DAW), swap pickers (drive page via URL params in v1), version-vs-version comparison (only track-vs-reference in v1), synced playback (single-track first; "synced" toggle v1.1).

**Critical:** don't conflate with `phase5_reference.py`. That runs DURING analysis when a reference WAV is uploaded with the track; Compare is a different flow (two already-analyzed tracks diffed on demand). Don't try to reuse phase5 at request time.

---

## Product decisions needed before build

Surface these to whoever owns product. Each blocks a specific design choice; defaults provided.

| Decision | Default | Pages affected |
|---|---|---|
| Does v1 ship share-link feedback or only read-only report sharing (today's `share_token`)? | Read-only report sharing only; feedback collection in Phase 3 | Discover (placeholder), Coach (no chat) |
| Activity log scope — dedicated `activity_events` table or UNION query? | UNION query over existing tables | Profile |
| Sub-grades (A+, B-) — pipeline-emitted or UI-computed `score / 10` modulo? | UI-computed modulo for v1 | Results, Library |
| Major/minor key detection in phase1 | Ship pitch class only (current); mode is post-v1 | Results, Listen |
| Cross-version `change` deltas on Results dimensionScores — real or stub? | Real (we have prior version data); show "—" for v1 of a song | Results |
| `confidence` field on verdicts — LLM self-report or computed from `priority_score`? | LLM self-report; clamp to 0.5-0.95 | Results, Coach |
| Reference URL ingest in v1? | No, file upload only | Profile, Compare |
| "Specialist runs" usage counter | Hide stat entirely in v1 | Profile |
| "Current version" semantics — auto (newest) or explicit `is_current` flag? | Explicit flag, default to newest | Library, Compare |
| Streaming platforms list (mock has 6 incl TikTok; current FE has 7 incl Beatport) | Use mock's 6 plus Beatport = 7 | Results streaming row |
| Reference cards' `lufs`/`truePeak`/`width` — pre-computed at add time or lazy? | Pre-computed via existing pipeline; reference-mode skips structure + specialists | Profile, Compare |
| Audio streaming auth model — JWT on streaming route, or signed-URL pattern? | JWT-on-route (works for local disk; same code for R2 later) | Listen, Compare |
| Chat history persistence | sessionStorage in v1; DB in v1.x | Coach |
| Activity log: cross-cutting write-instrumentation or read-only UNION? | UNION over `upload_jobs`/`songs`/`song_versions.created_at` | Profile |
| Designer cleanup: confirm `OverviewTab`/`AITab`/`StreamingTab`/`VerdictHero` are debris (defined but unrouted) — delete? | Yes, delete pending confirmation | Results |
| Designer cleanup: `AICoachTab` component body is missing from `results.jsx` — clarify before building? | Required | Results |

---

## Phased shipping plan

### Phase 1 — Core app (estimate: 6-8 weeks of evenings)

Goal: producer can register, upload audio, see analysis, run AI specialists, manage their library, write listening notes, share a read-only report link.

**Backend (C# BFF):**
- Port auth (JWT + refresh cookie) from FastAPI
- Songs + versions + library CRUD (new EF Core endpoints)
- Upload route (delegate to dramatiq `analyze_audio_job`)
- Result reads (`GET /api/jobs/{id}/results`, `GET /api/songs?include=…`)
- Verdict cache reads (`GET /reports/{id}/verdicts`)
- Per-specialist on-demand run dispatch
- Audio streaming (`GET /api/versions/{id}/audio` with `enableRangeProcessing`)
- Session notes CRUD (`POST/GET/PATCH/DELETE /api/versions/{id}/notes`)
- Profile identity + stats (`GET /api/me/profile`, `PATCH`, `GET /api/me/stats`)
- ShareSongModal works via existing `share_token` (no new code)

**Backend (Python worker):**
- Switch from Celery to dramatiq
- Add `precompute_waveform_peaks(job_id)` task
- Pipeline output additions: `phase1.short_term_lufs`, `phase1.sample_rate`, `phase1.bit_depth`, `phase1.frequency_clarity`, `phase1.frequency_label`, `phase7.arrangement_score`, `phase_results.duration_ms`, `dimensionScores[]`
- Verdict shape revision: add `body`, `metric_line`, `chart_type`, `impact`, `confidence`, structured `fix.steps[]`, `preset_name` to specialist prompt contract + Pydantic model

**Backend (schema):**
- Identity columns on `users` (handle, display_name, bio, banner_hue, avatar_hue, accent, public_link)
- `song_versions.is_current` bool + partial unique index
- `session_notes` table

**Frontend (React TS):**
- All pages: Results, Listen, Library, Profile (Unit A), Coach verdict list
- Component primitives: `Card`, `Pill`, `Meter`, `GradePill`, `ScoreRing`, `Sparkline`, `CoverArt`, `SectionTitle`, `VerdictCard`, `SpecialistTile`
- WaveSurfer.js integration for Listen
- AI SDK shell on Coach (with "Coming soon" overlay on input)
- ShareSongModal (re-skinned PublishToDiscoverModal)

### Phase 2 — References + Compare (estimate: 3-4 weeks)

**Backend:**
- `references` table + CRUD routes
- `reference_sets` + members join (or defer sets to v2.x if pressed)
- Reference-mode runner (existing pipeline against reference file, skipping structure + specialists for speed)
- `POST /api/compare` endpoint with match score formula
- `songs.default_reference_id` FK column

**Frontend:**
- Profile References tab
- Compare page (track vs reference)
- Reference cards + filter chips
- Add-reference zone (file upload only in v1)

### Phase 3 — Coach chat + share-link feedback (estimate: 3-4 weeks)

**Backend:**
- `POST /api/coach/{job_id}/chat` SSE endpoint (Vercel AI SDK Data Stream protocol)
- Context-builder serializing `final_json` + `verdicts_payload` + 2-3 prior versions
- (Per Claude Desktop research): `share_links` + `feedback_entries` + `feedback_comments` + `share_link_views` tables
- Anonymous reviewer routes (`POST /api/share/{token}/feedback`, `GET /api/share/{token}` returns audio + waveform + structured form)
- Transactional email on `feedback.created`

**Frontend:**
- Coach chat panel (remove "Coming soon" overlay; wire `useChat`)
- Anonymous reviewer page at `/r/{token}` (waveform + structured form: hooked rating 1-10, mix-clarity rating 1-10, where-you-gained-interest pin, where-you-lost-interest pin, "what would you change first?" free text, optional reviewer name)
- Producer dashboard surface for received feedback

### Phase 4 — Discover (post-launch, gated on Phase 3 success)

Trigger: ≥30% of uploads get ≥1 share-link feedback within 14 days; ≥50% producer "useful" rating.

Only then: build the public feed, public profiles, plays/saves, license/mood/genre taxonomy. Until that signal hits, keep Discover as the ShareSongModal placeholder.

---

## What this audit deliberately leaves alone

- **Existing analysis pipeline correctness** — assumes phases 1-8 produce what they say. No re-audit of `audio_analysis.run_pipeline()` itself.
- **Verdict validator authority** — `validate_verdict()` still overwrites `priority_score` and may downgrade `severity`; the new fields (`impact`, `confidence`, `body`, etc.) flow through unchanged.
- **AllIn1 / Demucs setup** — same Windows Docker requirement as today.
- **Migration tooling** — EF Core handles BFF tables; Alembic stays for worker tables. See `REQUIREMENTS_ARCHITECTURE.md`.

---

## Open follow-ups (not blocking but worth tracking)

- **DAW preset export** (Ableton `.adv`, FabFilter formats) is the right second product after the verdict-list ships. Defer until producer demand is proven.
- **Mobile UX** — design files are desktop-first; the reviewer page in particular needs a mobile-first redesign for share-link feedback (post-Phase 1).
- **Time-localized spectral data** — multiple pages reference per-section metrics ("breakdown drops energy too fast in 4 bars") that today live only in LLM-generated coach text, not deterministic data. Worth a follow-up pipeline pass post-v1.
- **Browser support floor** — Web Audio AnalyserNode for Listen's live meters requires Safari ≥ 14.1. Confirm floor before committing to AudioWorklet-based meters.
- **Cross-version "change" metric on dimension scores** — Library and Results both want it; ship in v1 with "—" placeholder for the first version of any song.
