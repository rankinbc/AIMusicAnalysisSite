# New Song Creation — Backend Requirements (companion to the UI handoff)

Companion to `new-song-creation-requirements.md`. This covers the data model, API,
analysis-pipeline wiring, and migrations needed to support the new song fields:
**description**, **reference profile**, and the **visual** (template + primary/secondary color).

Schema ownership: **EF Core is canonical**. The worker's SQLAlchemy models in
`components/shared/aimusic_shared/models.py` MIRROR the EF entities (no Alembic). Every
schema change is: (1) edit EF entity, (2) `dotnet ef migrations add …`, (3) mirror in
`models.py`. Drift is caught by fixture round-trip tests.

Current state (verified):
- Entity: `components/bff/src/Spectr.Data/Entities/Song.cs`
- DTOs: `components/bff/src/Spectr.Bff/DTOs/SongDtos.cs`
- Endpoints: `components/bff/src/Spectr.Bff/Endpoints/SongEndpoints.cs`
- Shared mirror: `components/shared/aimusic_shared/models.py` (`class Song`, ~L94)
- Migrations: `components/bff/src/Spectr.Data/Migrations/`
- Reference dispatch: `VersionEndpoints.cs::DispatchAnalysisAsync` (~L899) → `AnalysisJob.ReferenceId`
- Worker resolution: `components/worker/app/tasks_dramatiq.py` (~L136–149, L240)
- Genre presets: `components/analysis/src/audio_analysis/genre_presets.py` + `genre_profile_loader.py` + `data/reference_library/profiles/*.json`

> ⚠️ The `Song` entity **already has** `DefaultReferenceId` (Guid?, → `ReferenceTrack`)
> but it is **not exposed** in `CreateSongRequest` / `PatchSongRequest` / `SongDto`. The
> reference-profile work supersedes/extends this field — see §2.

---

## 1. New columns on `songs`

Add to `Song.cs` (with `[Column("snake_case")]`) and mirror in `models.py`.

| Property (C#) | Column | Type | Null | Constraints / default | Purpose |
|---|---|---|---|---|---|
| `Description` | `description` | `string?` | yes | MaxLength 500 | Free-text notes (metadata only v1). |
| `CoverTemplate` | `cover_template` | `string?` | yes | MaxLength 24; whitelist `aurora` \| `vinyl` | Visual template. |
| `CoverPrimaryHue` | `cover_primary_hue` | `short?` | yes | 0–359 | Primary color (hue). |
| `CoverSecondaryHue` | `cover_secondary_hue` | `short?` | yes | 0–359 | Secondary color (hue). |
| `ReferenceProfileKind` | `reference_profile_kind` | `string?` | yes | whitelist `track` \| `set` \| `genre` | Discriminator for the reference profile pointer (§2). |
| `ReferenceProfileSetId` | `reference_profile_set_id` | `Guid?` | yes | FK `reference_sets(id)` ON DELETE SET NULL | Set when kind=`set`. |
| `ReferenceProfileGenre` | `reference_profile_genre` | `string?` | yes | MaxLength 40; whitelist = available presets (§3) | Set when kind=`genre`. |

Notes:
- **Color representation = hue (smallint)**, matching the existing `CoverArt` oklch-hue
  math and the `ReferenceSet.Hue` precedent. The renderer already derives a full gradient
  from a hue, so two hues fully drive both templates. (If full per-channel color control
  is wanted later, migrate these to `char(7)` hex — out of scope for v1.)
- **All nullable** for back-compat. Existing rows have NULLs; the renderer falls back to
  the current `hueFromId(song.id)` Aurora look (see UI doc §4d). New songs normally store
  non-null visual values (UI prefills a random combo).
- **Reuse `DefaultReferenceId` for kind=`track`** rather than adding a 4th pointer: when
  `reference_profile_kind = 'track'`, the existing `default_reference_id` holds the track id.
  This keeps one canonical track pointer. (`kind` makes the 3 targets mutually exclusive.)

### Validation invariants (enforce in the endpoint, not just the DB)
- Exactly one of (`default_reference_id`, `reference_profile_set_id`, `reference_profile_genre`)
  is non-null, consistent with `reference_profile_kind`; or all null + kind null = "none".
- `cover_template` ∈ {`aurora`,`vinyl`} when present.
- `cover_primary_hue`, `cover_secondary_hue` ∈ [0,359] when present.
- `reference_profile_set_id` and `default_reference_id` must be **owned by the caller**
  (IDOR check — mirror the existing reference ownership validation in `DispatchAnalysisAsync`).
- `reference_profile_genre` ∈ available presets (§3).

---

## 2. Reference Profile — the polymorphic pointer

`ReferenceProfileKind` discriminates three mutually-exclusive targets:

| kind | stored in | resolves to | pipeline path |
|---|---|---|---|
| `track` | `default_reference_id` | one `ReferenceTrack` file | phase 5 single-track delta (already works) |
| `set` | `reference_profile_set_id` | a user `ReferenceSet` (collection) | **needs new aggregation — see ⚠️ below** |
| `genre` | `reference_profile_genre` | a built-in statistical profile (§3) | phase 6 gap-vs-profile (already works) |
| none | — | — | current default (no forced reference) |

### How it feeds analysis (dispatch wiring)
Today `DispatchAnalysisAsync` accepts an explicit `referenceId` and writes
`AnalysisJob.ReferenceId`; the worker resolves it to a single `reference_path`. Required change:

- When a version is analyzed **without** an explicit per-analysis reference, dispatch must
  **fall back to the song's reference profile**: read the song's `reference_profile_kind`
  and populate the analysis accordingly.
  - `track` → set `AnalysisJob.ReferenceId = default_reference_id` (existing path).
  - `genre` → pass the genre key into the pipeline's phase-6 profile selection (the pipeline
    already loads a statistical profile by genre key via `genre_profile_loader.load_profile`).
    Today genre is inferred via phase 2 / `genreHint`; this lets the song's chosen profile
    **override** the inferred genre for the gap analysis. Add a worker-side parameter
    (e.g. `genre_profile_override`) threaded into `run_pipeline`.
  - `set` → see ⚠️.
- Explicit per-analysis reference (chosen at upload time) still **overrides** the song default.

### ⚠️ User reference SET as a profile — scope decision (needs confirmation)
A `ReferenceSet` is a collection of the user's tracks. The pipeline has **no path** to
compare against a *set* today (phase 5 = one track; phase 6 = an aggregated genre profile).
Two ways to honor "user-created reference profiles" — pick one for v1:

- **Option A (lean, recommended for v1):** Treat a set as a **multi-track phase-5
  comparison** — resolve the set to its member tracks and compare against them (cap N, e.g.
  the most-used or first 3), reusing the existing single-reference machinery per member.
  No new statistical-profile builder. Smaller build; "profile" = "compare against these refs."
- **Option B (full parity with genre presets):** Build a **per-user statistical profile**
  by aggregating the set's member-track features (the same shape as `*_profile.json`), cache
  it, and feed phase 6 like a genre profile. Most powerful, matches the genre-preset model,
  but it's a real subsystem (feature aggregation + caching + invalidation when set membership
  changes). Defer unless wanted.

If undecided, ship **genre presets + single-track** in v1 and gate `set` behind Option A/B
as a follow-up. The UI can still show "My profiles" but mark sets as "coming soon" or wire
them to Option A.

---

## 3. Available genre presets (authoritative list)

The UI must only offer presets that the backend can actually back. Currently defined in
`genre_presets.py` (`GENRE_PRESETS`) and `data/reference_library/profiles/`:

- ✅ `trance`, `house`, `techno`, `dnb` (drum & bass), `progressive`

> ⚠️ **Hip-Hop and Pop do NOT exist** as presets/profiles. The UI handoff listed them; the
> backend cannot support them without **generating new profile JSONs** (statistical profiles
> built from a reference corpus — a separate offline task) and adding `GenrePreset` entries.
> v1 requirement: **either** limit the UI preset list to the 5 above, **or** add a backlog
> item to generate Hip-Hop / Pop / House-variant profiles before exposing them.

Endpoint requirement: expose the available presets to the frontend (e.g.
`GET /reference-profiles/presets` returning `[{key,name,description}]`) sourced from
`GENRE_PRESETS` — do **not** hardcode the list in the frontend (it drifts).

---

## 4. API changes

### DTOs (`SongDtos.cs`)
Extend the three records (additive, nullable → back-compatible):

```csharp
public sealed record CreateSongRequest(
    string Name,
    string? GenreHint,
    string? Description,
    string? CoverTemplate,
    short? CoverPrimaryHue,
    short? CoverSecondaryHue,
    string? ReferenceProfileKind,
    Guid? DefaultReferenceId,
    Guid? ReferenceProfileSetId,
    string? ReferenceProfileGenre);

public sealed record PatchSongRequest(
    string? Name,
    string? GenreHint,
    string? Description,
    string? CoverTemplate,
    short? CoverPrimaryHue,
    short? CoverSecondaryHue,
    string? ReferenceProfileKind,
    Guid? DefaultReferenceId,
    Guid? ReferenceProfileSetId,
    string? ReferenceProfileGenre);
```
- `SongDto` gains the same read fields (`Description`, `CoverTemplate`, `CoverPrimaryHue`,
  `CoverSecondaryHue`, `ReferenceProfileKind`, and a resolved reference-profile summary —
  e.g. `{kind, label, hue?}` so the card/header can render it without extra lookups).
- **PATCH semantics**: keep the existing partial-update pattern. To let a user *clear* the
  reference profile, define a clear convention (e.g. `reference_profile_kind = "none"` clears
  all three pointers). Document it so PATCH can distinguish "unchanged" from "cleared".

### Endpoints (`SongEndpoints.cs`)
- `POST /songs` and `PATCH /songs/{id}`: accept + validate the new fields (§1 invariants),
  IDOR-check `reference_profile_set_id` / `default_reference_id` ownership.
- New: `GET /reference-profiles/presets` (or fold into an existing config endpoint) — see §3.
- Touch `UpdatedAt` on patch (existing behavior).

### Frontend types (`api/types.ts`)
Mirror the new fields on `SongDto`, `CreateSongRequest`, `PatchSongRequest`, and add a
`ReferenceProfilePreset` type for the presets endpoint.

---

## 5. Migration

- `dotnet ef migrations add AddSongDescriptionVisualAndReferenceProfile --project src/Spectr.Data --startup-project src/Spectr.Bff` then `dotnet ef database update …`.
- Plain nullable column adds + one FK (`reference_profile_set_id → reference_sets`) — **no
  manual partial-index SQL** needed (unlike the `is_current` gotcha). Verify the FK uses
  `ON DELETE SET NULL` (a deleted set must not delete songs).
- Mirror all columns in `components/shared/aimusic_shared/models.py` `class Song` (same column
  names, nullable, FK to `reference_sets.id`). Re-run the fixture round-trip / drift tests.

---

## 6. Tests (minimum)

- Create song with **Name only** → all new fields null; renders via fallback. (expected-use)
- Create with full visual + genre-preset profile → persists + round-trips in `SongDto`. (expected-use)
- PATCH visual + change reference profile kind `genre`→`set`; and clear to `none`. (edge)
- IDOR: reference set / track owned by another user → rejected. (failure)
- Invalid `cover_template` / hue out of range / unknown genre preset → 400. (failure)
- Dispatch: analyzing a version with no explicit reference uses the **song's** profile;
  explicit per-analysis reference overrides it. (integration)
- Shared-model drift test passes after mirroring.

---

## 7. Open decisions to confirm before build

1. **Reference SET as profile** — Option A (multi-track phase-5 compare) vs B (per-user
   statistical profile) vs defer sets to follow-up. (§2 ⚠️)
2. **Genre preset list** — limit UI to the 5 existing profiles, or commit to generating
   Hip-Hop/Pop/etc. profiles first. (§3 ⚠️)
3. **Color model** — hue smallint (recommended, reuses renderer) vs hex strings.
4. **Song reference profile overriding inferred genre** for phase 6 — confirm we want the
   song's chosen `genre` profile to take precedence over phase-2-inferred genre.
