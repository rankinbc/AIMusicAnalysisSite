# SPECTR Input-Value & Flow Strategy

**Research deliverable — what inputs to ask users for, and how to sequence them**
Date: 2026-06-17 · Branch: `research/input-value-strategy` · Status: recommendation (no production code changed)

---

## 0. Headline recommendation

**Require the mix. Push the `.als` hard. Keep stems optional.** The `.als` project file is SPECTR's single
highest value-per-burden input — it is *one file* (low friction) yet it is the *only* input that carries the
track names, device chains, MIDI/harmony and arrangement markers needed to turn a generic finding ("your low-mids
are muddy") into the product's defensible moat: a project-specific prescription ("Track 12 'SUB-DEEP' is masking
your kick at 60 Hz — sidechain it or carve 2 dB at 65 Hz"). Stems are genuinely valuable for *clash attribution*
and *per-stem balance*, but the per-stem reference-delta tier has steeply diminishing returns (it needs matched
*reference* stems too, and silently degrades to `"unavailable"` otherwise) and the export burden in Ableton is
heavy. The biggest unrealized opportunity is **not collecting more inputs — it is wiring the `.als` track/device
map that the code already parses into the verdict layer**, which today still emits stem-*role* advice ("cut the
bass") instead of track/device advice ("cut Track 12's Auto Filter"). The recommended flow therefore parses the
`.als` *first* to build a track/device map, then projects audio + stem findings onto it. This makes "+.als" the
tier to evangelize and "stems" the depth tier for power users — matching the market thesis that *prescription
specificity scales with input depth*, and matching the closest competitor (Slapback), which already markets the
Ableton file as optional-but-"even more specific."

---

## 1. Why this matters: the moat is prescription specificity, not measurement

The strategy docs are unambiguous that SPECTR cannot win on measurement — free tools already analyze millions of
tracks. The only defensible edge is turning analysis into *what to do*, named to the user's own project:

- *"The moat is Analysis → AI prescription. We can't out-measure established analyzer/metering tools; the only
  defensible edge is turning the analysis into what to do."* (product brief, 2026-06-16 update)
- *"Move-specificity scales with input depth: mix-only → directional · +reference → genre-target · +stems →
  stem-specific · +.als → device-specific & confident."* (product brief)
- The unoccupied whitespace is specifically *".als + rendered-audio dual analysis in one report"* and *"per-stem
  clash table as a SaaS deliverable"* — nobody combines project-file introspection with full DSP analysis of the
  bounce. (market research)

External evidence agrees on what "actionable" means: *"Your vocal is masked between 2–4 kHz by the rhythm guitar"*
is useful; *"Mix quality: 7/10"* is not. Every insight should name the band, the dB, the device, and the location
([bestaitools / Mix Check Studio](https://www.bestaitools.com/tool/mix-check-studio/),
[mixmasterpro](https://mixmasterpro.io/articles/ai-mix-analysis-vs-ai-mixing)). **Specificity is the product.**
The input question is therefore really: *which inputs buy the most specificity per unit of user pain?*

---

## 2. What each input actually unlocks (grounded in the code)

### 2.1 Mix-only (the baseline — required)

`run_pipeline(file_path)` with no stems/reference/.als runs phases 1,2,3,4(spectral),6,7,9 (phase 5 skipped,
phase 8 skipped). It produces a genuinely useful report:

- **Phase 1** (`phases/phase1_universal.py`): 13 fields — `lufs`, `true_peak_db` (4× oversampled dBTP),
  `clipping_detected`, `bpm`, `detected_key`, `stereo_correlation`, `mono_compatibility`, `low_energy`, 7-band
  spectral profile (`bands.{sub_bass…air}`), `duration_seconds`.
- **Phase 4** (`phases/phase4_stems.py`, `USE_DEMUCS=False`): mix-level spectral clash detection — but only
  *generic* clashes: `{"stems": "low-end buildup", "frequency_range": "sub-bass / bass (20–200 Hz)", "severity":
  "high"}`. **It cannot say which instrument causes the buildup.**
- **Phase 5**: skipped → no reference deltas, but genre-context checks (LUFS/BPM/correlation vs. genre preset)
  still run.
- Rollups: `overall_score`/`grade`, `danceability_score`, `top_fixes`, coach intro.

**Verdict layer on mix-only:** the rule engine + measured findings + the non-stem specialists (LowEnd, Dynamics,
StereoPhase, FrequencyBalance, Loudness, Sections) all run. Advice is **directional/mix-level**: "reduce the
low-end," "your crest factor is low — back off the limiter." Good enough to be the no-card funnel entry, exactly
as the brief requires.

### 2.2 Stems (optional depth — valuable but with real diminishing returns)

When `stem_paths` are provided, `phase4_stems.py::_analyze_user_stems` → `stems/analyzer.py::analyze_grouped`
unlocks three distinct capabilities. Ranked by producer value:

| Capability | Code | What it produces | Producer value | Honest caveat |
|---|---|---|---|---|
| **Clash attribution** | `clash_matrix` (`analyzer.py`) | Pairwise role×band overlaps: `{stem_a:"drums", stem_b:"bass", band:"sub", overlap_severity:0.62, severity_tier:"warning"}` | **HIGH.** This is the headline upgrade — it converts "low-end buildup" into "kick vs. bass clash at 60 Hz." This is the per-stem clash table the market doc calls unoccupied whitespace. | Needs correct role labels; grouped mode sums same-role stems into a bus. |
| **Per-stem balance** | `balance_flags` | `{role:"bass", metric:"rms_db", observed:-10.8, expected_range:[-12,-8], direction:"too_high", severity_tier:"warning"}` → drives the `stem_balance` specialist | **HIGH.** "Your bass is 3 dB hotter than genre norm" is directly fixable. | Only emits when a genre preset supplies per-role expectations. |
| **Per-stem stereo width** | `per_stem[role].stereo_width`, `pan_estimate`, `is_mono` → `stem_stereo_width` specialist | "Your kick stem is 0.4 wide — mono it" | **MEDIUM.** Real, but a smaller class of problems than clash/balance. | — |
| **Per-stem reference delta** | `phase5_reference.py::compare_stems` → `per_stem_reference_deltas` (11 deltas/role) → `stem_reference_delta` specialist | "Your drums are 2.5 dB quieter than the reference's drums in the sub band" | **LOW value-per-burden.** Analytically rich (110+ deltas for 10 roles) but… | …requires the user to supply **matched reference stems** on top of their own stems. `phase5_reference.py` returns `"stem_reference_comparison": "unavailable"` when user stems exist but reference stems don't — which is the overwhelmingly common case. The full tier almost never fires in practice. |

**The honest read on stems.** Two of the four capabilities (clash attribution, balance) are worth the burden and
are genuine differentiators. Stereo width is a nice-to-have. Per-stem reference delta is a research-grade feature
that, in the real world, rarely has the inputs to run — it should not drive the stem ask. And the burden is
heavy: exporting stems in Ableton is a multi-step manual chore — switch to Arrangement view, align to bar 1, set
"All Individual Tracks," extend the tail, and *repeat the export per group/return track soloed one at a time*
([Ableton help](https://help.ableton.com/hc/en-us/articles/360000843404-Importing-and-exporting-stems),
[bchillmix](https://bchillmix.com/blogs/news/export-stems-ableton-live-step-by-step)). For a 20-track project this
is 10–20 minutes of tedium per analysis — and producers analyze iteratively. **That is a poor trade for most
users most of the time**, which is why stems must stay optional and never gate first value.

> Note on Demucs: `USE_DEMUCS=False` is set in `phase4_stems.py`. Auto-separating the mix into stems would remove
> the export burden entirely, but at 10–20 min CPU/track it is out of MVP scope (per brief). HOW to get stems
> (ask vs. auto-separate vs. classify) is the sibling `research/stem-classification` window's problem — this doc
> only argues the *value*, which says: clash + balance are worth having; the cheapest path to them wins.

### 2.3 The `.als` project file (optional but should be PUSHED — highest value-per-burden)

It is **one file**, ≈zero export effort (it already exists on disk after every save), and
`als/als_parser.py::ALSParser.parse` extracts a remarkably rich structured map. Confirmed extracted fields:

- **Per-track identity & routing:** `Track{ id, name, track_type (midi/audio/return/group/master), color,
  is_muted, is_solo, volume_db, pan, devices[], midi_clips[], audio_clips[] }`. **Track names + per-track device
  lists** are the keys that make advice project-specific.
- **Device/plugin detail** (`als_parser.py` device extraction): per device `{ name, type (e.g. "AutoFilter",
  "PluginDevice"), device_type (native/vst/max_for_live), enabled, params{} }`, plus a project-wide
  `plugin_list[]`.
- **MIDI / harmony** (`MIDIAnalyzer`): per track `velocity_mean/std`, `humanization_score`
  (robotic→natural), `quantization_errors[]`, `note_density_per_bar`, `chord_count`, `chords[]` (with
  `chord_name`), `swing_ratio`. Project totals: `midi_note_count`, `total_chord_count`, `has_humanized_midi`,
  `quantization_issues_count`.
- **Arrangement structure:** `project_structure.locators[]` (named section markers + times), `scenes[]`,
  `tempo_automation[]`; phase 8 derives `arrangement.pattern` ("intro-buildup-drop" / "verse-chorus") and
  per-section `{name, start_beat, duration_bars}`. This is *real* structure from the user's own markers — far
  better than phase 7's generic structural guesses.
- **Project health** (`health_scorer.py`): `health_score`/`grade`, `total_devices`, `disabled_devices`,
  `clutter_pct`, per-track summaries — workflow quality signals.

**What `.als` unlocks that audio can NEVER provide:** the *names and the device chains*. Audio analysis can find a
masking problem at 250 Hz; only the `.als` knows the offending region belongs to a track the user called "TRITON
Pad" running an "Auto Filter" and an "EQ Eight." That is the difference between "cut 250 Hz somewhere" and "on
your TRITON Pad track, the Auto Filter's resonance is parked at 250 Hz — pull it down." It also uniquely unlocks
**harmony/MIDI advice** (chord clashes, robotic velocities, quantization), **structural advice keyed to the user's
own section names**, and **project-hygiene advice** (muted tracks, disabled-device clutter).

---

## 3. The actionable-insight opportunity: device-specific advice is mostly DORMANT

This is the most important finding for the product owner, because it changes where effort should go.

**The plumbing largely exists, but the linkage does not.** Grounded in the worker code:

- **Grounding works** (`verdict_lib/input_grounding.py`): every specialist prompt is prepended with an
  authoritative preamble declaring which inputs were provided, and the entire flattened analysis JSON (including
  phase 8 `.als` data when present) is dumped into the user message. So the data *reaches* the model.
- **Stem specialists are properly gated** (`prompts/experts/Triage.md`): `stem_balance`, `stem_stereo_width`,
  `stem_reference_delta` route only when `phase4.stems.status == "ok"` (and, for the delta, when
  `phase5.stem_reference_comparison == "ok"`). This is the correct pattern.
- **`.als`-aware prompts already exist but are not wired the same way:** `DeviceChainAnalysis.md`,
  `FrequencyCollisionDetection.md`, `SectionContrastAnalysis.md` read `tracks[].name`, `tracks[].devices[]`,
  `midi_analysis[].track_name`, and locators — and `DeviceChainAnalysis.md` even drafts track-named advice like
  *"[BASS] 26-MonoPoly … Add EQ8: High-pass at 30Hz, cut 2-3dB at 200-300Hz."* The `Fix` schema
  (`shared/.../verdicts/models.py`) carries an `ableton_hint{device, band, preset_name}`.

**But three gaps stop it shipping as track/device advice:**

1. **Triage doesn't gate/route on `.als` presence** the way it does on stems. There is no `als.status == "ok"`
   branch that turns on the device/collision/section specialists. So these prompts are defined but effectively
   dormant in the routed pipeline.
2. **Verdict targets carry a stem *role*, not a track name.** `fix.target = {type:"stem", name:"bass"}` — `name`
   is "bass," never "Track 12" / "26-MonoPoly." There is no mapper from a finding → the `.als` track that owns it.
3. **`.als` data currently lands mainly in the *coach* context** (`coach_lib/context.py` picks up `als_summary`),
   not in the specialist targeting path.

**The opportunity (this is the recommendation that compounds):** the single highest-leverage product investment
is not a new input — it is the **finding→track→device attribution layer** that (a) adds an `als.status` gate to
Triage mirroring the stem gate, (b) lets verdict `fix.target` resolve to an `.als` track name + device +
`ableton_hint`, and (c) projects audio/stem findings onto the `.als` track map. This converts existing
dormant prompts into the product's headline differentiator with no new user burden. (The mechanics of *extracting*
the `.als` internals are the sibling `feat/als-instant-preview` window's job; this doc establishes *why it's the
priority* and *what it unlocks*.)

---

## 4. Proposed upload flow / ordering: parse `.als` first

Today `run_pipeline` runs `.als` last (phase 8). For the *prescription* goal, the ideal logical ordering inverts
that — parse the project structure first so every later finding can be attributed to a track/device:

```
STEP 0 — MIX (required)            → instant, no-card report. Directional findings.
   unlocks: score/grade, LUFS/true-peak/clip, key/BPM, 7-band balance, genre-context,
            mix-level clash ("low-end buildup"), directional verdicts.

STEP 1 — .als (push hard, 1 file)  → parse FIRST: build the track/device/MIDI/arrangement MAP.
   unlocks: track names + device chains + plugin list + MIDI/harmony + named arrangement
            sections + project-health. CRUCIALLY: a map onto which Step-0 findings attach.
   → "your 250 Hz mud → TRITON Pad track → Auto Filter resonance"  (device-specific advice)
   → chord/quantization/humanization advice; section-named structural advice; clutter/mute hygiene.

STEP 2 — Reference (optional, 1 file, low burden) → genre/target deltas.
   unlocks: phase5 mix-level deltas (LUFS/RMS/correlation/bands vs. a track they admire).
            Cheap and high-perceived-value; good "second ask."

STEP 3 — Stems (optional depth, heavy burden) → clash attribution + per-stem balance/width.
   unlocks: clash_matrix (kick vs bass @ 60Hz), balance_flags, per-stem width.
   note: with .als already present, stem roles can be cross-checked against track names —
         and per-stem findings become per-TRACK findings ("your 'SUB-DEEP' stem…").

STEP 3b — Reference stems (rarely available) → per-stem reference delta. Lowest priority; don't push.
```

**Why .als before stems:** the `.als` is cheap and it is the *coordinate system* for everything else. With the
track map in hand, a mix-only masking finding already becomes track-specific; adding stems then sharpens
attribution further and can be *named to the user's track* rather than to an abstract role. Sequencing stems first
(heavy burden) before the cheap, map-providing `.als` would be backwards.

---

## 5. Tiered recommendation: require / encourage / optional

| Tier | Input | Posture | Rationale |
|---|---|---|---|
| **T0 — Required baseline** | **Mix (bounce)** | **Require.** No card, no account, <3 min to first report. | Friction barrier + funnel thesis. Must yield a useful directional Plan from rule-engine + measured findings alone. |
| **T1 — The hero ask** | **`.als` project file** | **Strongly encourage / push hard.** | One file, ≈zero burden, unlocks the device-specific moat. This is the differentiator vs. all audio-only competitors and the input depth that justifies Pro. Core persona (Dario) already has it. |
| **T1.5 — Easy second ask** | **Reference track** | **Encourage.** | One file, low burden, high perceived value (genre/target deltas). Natural companion to .als. |
| **T2 — Depth for power users** | **Stems** | **Optional.** Offer prominently, never gate first value, never auto-spend credits. | High value (clash/balance) but heavy export burden. Worth it for the committed user iterating toward release; overkill for the casual first run. |
| **T3 — Don't push** | **Reference stems** | **Optional, de-emphasized.** | Enables per-stem reference delta, but the matched-stems requirement means it almost never has the inputs. Surface only when both stem sets already exist. |

**Governance caveats from the docs (carry these):** (1) Depth is the *upsell*, not a paywall-to-basics — the free
tier must be genuinely useful on mix-only. (2) `.als` is Slapback's home turf and they lead with an in-browser
privacy story — SPECTR's server-side parse needs a privacy answer (no-training pledge or client-side parse).
Hedge by weighting the *combination* (.als + stems + genre + versions), not `.als` alone.

### 5.1 User-facing messaging (frame every ask as worth it)

- **Mix (T0):** *"Drop your track. No account, no card — see your mix score, loudness, and top fixes in under two
  minutes."*
- **`.als` (T1) — the key push.** Frame it as the upgrade from *advice* to *instructions in YOUR project*:
  - *"Add your Ableton project file (1 file, already on your drive) and we'll name the exact track and device to
    change — e.g. 'pull the resonance on your Auto Filter,' not just 'cut 250 Hz somewhere.'"*
  - At the result: a locked/teaser card — *"We found mud at 250 Hz. Upload your .als to see which track and device
    is causing it."* (This mirrors Slapback's proven framing: the Ableton file is optional but *"the feedback gets
    even more specific"* — [slapback.io/faq](https://slapback.io/faq).)
  - Privacy line next to the ask: *"Parsed for analysis only. Never used to train models. [How we handle your
    project →]"*
- **Reference (T1.5):** *"Add a track you want to sound like — we'll show you exactly where yours differs (low end,
  loudness, width)."*
- **Stems (T2):** *"Got stems? Upload them to see which instruments are actually clashing — 'kick vs. bass at
  60 Hz,' not just 'busy low end.' (Optional — takes a few minutes to export.)"*
- **Reference stems (T3):** surface only contextually when stems + a reference are both already attached.

---

## 6. Risks, dependencies, and what this doc deliberately doesn't decide

- **The T1 payoff depends on the dormant-linkage work** (§3). Pushing `.als` hard while still emitting role-level
  advice would under-deliver on the promise. Sequence: build the `.als`-gate + track/device attribution *before*
  marketing "device-specific advice."
- **Privacy answer for server-side `.als`** is a real competitive gap vs. Slapback — must ship alongside the push.
- **Stem role correctness** matters for clash attribution to be trustworthy — handled by the
  `research/stem-classification` window; this doc assumes roles can be obtained acceptably.
- **Out of scope here (by coordination):** *how* to classify/auto-separate stems, and *how* to extract `.als`
  internals robustly — the two sibling windows own those. This doc owns the value-vs-burden and sequencing layer.

---

## 7. Evidence index

**Code (this repo):** `analysis/src/audio_analysis/pipeline.py` (run_pipeline ordering); `phases/phase1_universal.py`
(mix fields); `phases/phase4_stems.py` (USE_DEMUCS flag, generic vs. clash_matrix); `stems/analyzer.py`
(analyze_grouped, clash_matrix, balance_flags); `phases/phase5_reference.py` (per_stem deltas + "unavailable"
degrade); `phases/phase8_als.py` + `als/als_parser.py` + `als/health_scorer.py` (.als extraction);
`worker/app/verdict_lib/input_grounding.py` + `triage.py` (grounding + stem gating, no .als gate);
`worker/prompts/experts/{StemBalance,StemStereoWidth,StemReferenceDelta,DeviceChainAnalysis,FrequencyCollisionDetection}.md`;
`shared/aimusic_shared/verdicts/models.py` (Fix.target / ableton_hint); `worker/app/coach_lib/context.py` (als_summary→coach only).

**Strategy docs:** `PRPs/research/market-spectr-ai-music-analyzer-2026-06-12.md`; `PRPs/product-brief-spectr-2026-06-12.md`.

**External:**
- AI mix feedback actionability — [bestaitools/Mix Check Studio](https://www.bestaitools.com/tool/mix-check-studio/),
  [mixmasterpro](https://mixmasterpro.io/articles/ai-mix-analysis-vs-ai-mixing),
  [trackscore.ai](https://trackscore.ai/blog/best-music-analysis-tools)
- Ableton stem-export burden — [Ableton help](https://help.ableton.com/hc/en-us/articles/360000843404-Importing-and-exporting-stems),
  [bchillmix](https://bchillmix.com/blogs/news/export-stems-ableton-live-step-by-step),
  [music-prod](https://music-prod.com/tutorials/ableton-live/how-to-export-stems)
- Competitor `.als`-as-optional-but-more-specific — [Slapback FAQ](https://slapback.io/faq),
  [slapback.io](https://slapback.io/), [Slapback pricing](https://slapback.io/pricing)
