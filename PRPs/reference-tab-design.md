# Reference Tab — Design (results page, Tab "Reference")

**Status:** design (approved 2026-06-26)
**Scope:** the content of the **Reference** tab on the analysis results page. Read-only presentation of how the user's track compares to a reference target. Visual build is Claude Design's; this defines *what's on the tab* and *what data binds where*.
**Reconcile with:** the incoming new results-page design (frame/tabs) — this spec is the tab's *content*, independent of the page chrome.

---

## 1. Purpose & visibility

Show how the user's mix stacks up against a chosen **reference target**: a **reference profile** (the user's generated set aggregate, or a genre preset) and/or a single **reference track**.

- **Conditional tab** — appears **only** when a reference profile *or* a single reference track is attached to the analysis (like the Project/.als tab). No empty/"attach a reference" state on the tab itself; when nothing is attached, the tab isn't in the bar.
- **Read-only** — the comparison target is set upstream (song settings / re-analyze). No in-tab picker or re-run. The tab renders whatever phase 5/6 computed.
- The **detected-genre** statistical comparison is **not** here — it lives in General Stats / Track Info (decision model (a), 2026-06-26). This tab is the *chosen-target* comparison.

## 2. Comparison model — profile-led, single track as overlay

One visualization, two data layers:
- **Primary:** the profile **range** comparison — `you ● · acceptable range ▒▒ · profile mean │ · percentile`.
- **Overlay:** if a single reference track is attached, its value renders as a `◇` marker on the same bars/curve ("their track sits here").

Legend (consistent across the tab): `● you · ▒▒ acceptable range · │ target mean · ◇ ref track`.

## 3. Data sources (what binds)

| Layer | Source | Shape |
|---|---|---|
| Profile gaps (range, percentile, in/out-of-range) | **phase 6** `phase6.gaps` | `Record<feature, Phase6Gap>` — `user_val, genre_mean, genre_std, acceptable_range, delta, percentile, in_range, description` |
| Profile identity/labels | phase 6 | `profile_kind` (`user` \| `genre` \| `genre_statistical`), `profile_name`, `profile_hue`, `track_count`, `profile_source` |
| Profile aggregate (for the band curve ±2σ) | `GET /reference-sets/{id}` → `profileJson.feature_statistics` | `{ feature: { mean, std } }` over `lufs, true_peak, dynamic_range, stereo_width, stereo_correlation, bpm, band_sub_bass…band_air` |
| Single reference track values (the `◇` overlay) | **phase 5** deltas / the attached `ReferenceDto` | per-metric `user_val` vs `ref_val` (delta); `bandLevels` for the curve |

Features (axes): scalars **LUFS · True Peak · Dynamic Range · Stereo Width · Stereo Correlation · BPM**; tonal **7 bands** (sub-bass → air). Reuse the label/unit map already in `ReferenceTab.tsx` (`GAP_LABELS`).

## 4. Layout (top → bottom)

**1. Target identity bar.** What you're comparing against:
- Profile → hue `●` + name + kind chip (`Your profile` / `Genre preset`) + "based on N tracks" (`track_count`).
- Single track → `vs "Track Title" — Artist`.
- Both → profile is primary + "overlaying *Track Title*".

**2. Verdict summary.** The percentile ring (reuse the existing `ReferenceTab` ring) + "**M of N metrics in range**" + a plain-language takeaway derived from the gaps (e.g. *"Right in the pocket"*; *"Your low end runs hotter than your references"*).

**3. Tonal fingerprint (HERO).** The 7-band EQ-style curve (sub-bass → air): target `mean ± 2σ` as a shaded band, **your track overlaid** as a line, single ref track as `◇` markers when attached. This is the spectral "shape match" read. Reuse the band-curve vocabulary from `references-ui-requirements.md §7b` so the profile detail view and this tab look identical (CSS/SVG; Recharts only if a real chart is warranted).

**4. Metric gap rows.** The scalars as range bars — extend the existing `GapRow` with the `◇` overlay marker. Each row: label, `yours <val>` (tinted in/out-of-range), `mean <val>`, the bar (`▒▒` range, `│` mean, `●` you, `◇` ref), and the metric percentile.

**5. Out-of-range → Findings.** Each **out-of-range** metric shows a subtle "**see in Findings →**" affordance that deep-links to the matching finding (when one exists), tying the comparison into the fix flow.

## 5. States

| State | Render |
|---|---|
| **Profile + track** | Full: range bars + `◇` overlay + percentile + band curve (target band, your line, `◇` markers). |
| **Profile only** | Full range comparison; no `◇` overlay. |
| **Single track only** (no profile) | No range bands / no percentile (a profile-of-one has no spread). Bars collapse to a **delta read**: `●` you ↔ `◇` their track + the Δ; band curve shows your line vs the ref track's bands; verdict line → "vs *Track* — N metrics differ". |
| **Profile not ready** (`analyzed_count == 0`) | "This profile has no analyzed tracks yet" + which members are `pending`/`failed`. No curve. |
| **Profile partial** (`analyzed_count < member_count`) | Full aggregate over analyzed members + note: "based on N of M tracks — analyze the rest to refine." |

## 6. Reuse / consistency

- Extend `features/results/ReferenceTab.tsx` (`GapRow`, the percentile ring, `GAP_LABELS`) — don't rebuild.
- Match the profile band-curve + `±2σ` range vocabulary in `references-ui-requirements.md §7b` so the References library detail view and this tab read identically.
- Keep the profile **hue identity** (`●` dot) consistent with the set chips / `ReferenceProfileSelect`.
- CSS Modules + `tokens.css` + global utilities; no Tailwind; reduced-motion respected.

## 7. Out of scope

- Choosing/switching the comparison target from the tab (read-only; set upstream).
- The References **library** + profile **detail** views (`references-ui-requirements.md`).
- Backend / phase-6 wiring (`reference-profiles-backend.md`).
- The detected-genre gap (lives in General Stats / Track Info).

## 8. Open / awaiting

- Reconcile the visual treatment with the incoming new results-page design once provided.
- Single-track delta path: confirm whether the `◇` overlay reads phase-5 `deltas` or the attached `ReferenceDto` values (both available); pick the one the new page wires.
