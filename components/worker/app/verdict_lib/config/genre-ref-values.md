# Genre Reference Values for a Mix-Analysis Rule Engine: 90s/Classic Trance, Modern Trance, and Techno

## TL;DR
- **Two loudness worlds per genre.** Master to roughly **−14 LUFS / −1 dBTP** for streaming (Spotify, YouTube, Tidal, and Amazon all normalize to −14 LUFS; Apple −16; Deezer −15), but the **club/DJ-pool master for all three genres sits far hotter at −8 to −6 LUFS** (techno and modern festival trance push hardest; some tracks exceed −6). These are different deliverables — encode both in the config.
- **Tempo centers are well-established.** 90s/classic trance ≈ **130–140 BPM (center ~135)**, modern uplifting/festival trance ≈ **136–142 BPM (center ~138–140)**, techno ≈ **125–150 BPM with peak-time/driving centered ~128–135**. Progressive/melodic strands run slower (126–134).
- **Dynamics fall sharply from the 90s to today.** Original-era 90s trance CDs measure ~**DR10–11 (crest ~10–11 dB)**; modern trance and techno are far denser at ~**DR5–7**, with club masters often at **LRA 3–5 LU**. A **−1.0 dBTP** true-peak ceiling is the cross-genre standard (−2 dBTP if mastering hotter than −14 LUFS).

## Key Findings

**The streaming-vs-club distinction is the single most important config decision.** Every credible source agrees streaming platforms normalize to a fixed target and *turn loud masters down*, so loudness above the target buys nothing on streaming and only sacrifices dynamics. Spotify, YouTube, Tidal, and Amazon Music normalize to −14 LUFS integrated; Apple Music to −16 LUFS; Deezer to −15. Yet club/DJ/Beatport delivery is a separate, much louder convention (−8 to −6 LUFS, sometimes louder), because DJs compare waveforms in Rekordbox and festival systems want density. The recommended modern workflow is two masters: a −14 LUFS/−1 dBTP streaming master and a −8 to −6 LUFS/−0.1 to −1 dBTP club master.

**Standards vs rules-of-thumb vs interpolation** (flagged throughout):
- **Well-established standards**: ITU-R BS.1770 (the K-weighted loudness measurement algorithm, first published 2006, latest BS.1770-5 in 2023), EBU R128 (target −23.0 LUFS ±0.5 LU with true peak not exceeding −1 dBTP, for broadcast; PLOUD Group led by Florian Camerer of ORF, first issued August 2010, v5.0 in 2023), and the published streaming normalization targets. These are authoritative.
- **Production rules-of-thumb**: genre LUFS club targets, LRA/crest figures, mono-below-100–120 Hz, tonal-tilt descriptions. Widely repeated by mastering engineers but not formal standards.
- **My reasonable interpolation**: precise per-genre center values where sources give ranges; spectral-centroid/brightness ordering across genres; some crest-factor numbers derived from LUFS + true peak.

## Details

### 1. LOUDNESS & DYNAMICS

#### Integrated LUFS — streaming-normalized targets (cross-genre platform facts)
- **Spotify**: −14 LUFS integrated (default "Normal"); user-selectable "Loud" −11 and "Quiet" −19. Spotify Support states verbatim: *"Keep it below -1dB TP (True Peak) max… If your master is louder than -14dB integrated LUFS, keep True Peak below -2dB to avoid extra distortion."*
- **Apple Music**: −16 LUFS via Sound Check. Per iZotope, *"Apple Music uses -16 LUFS – most of the time – Deezer uses -15"*; Apple's −16 aligns with the AES TD1008 recommendation.
- **YouTube**: −14 LUFS (one source cites −13 for YouTube Music; both within a rounding of each other). YouTube's AAC encoding can add up to ~1 dB of intersample peaks — a reason to hold true peak at −1.0 dBTP, not 0.
- **Tidal, Amazon Music**: −14 LUFS. **Deezer**: −15 LUFS. (Pandora does not strictly use LUFS; ≈ −13 to −14.)
- **Practical universal deliverable**: a single −14 LUFS / −1 dBTP master translates across the −14 cluster and plays fine on Apple, which turns it down ~2 dB.

#### Integrated LUFS — typical club/DJ/master loudness (genre-specific, rule-of-thumb)
- **90s/classic trance (as originally released)**: original CDs were comparatively dynamic — measured crest (DR) ~10–11 dB (see dynamics below), implying integrated loudness roughly in the −12 to −9 LUFS region by modern measurement, *not* the −6 LUFS of today. A faithful "classic" profile should be the most dynamic of the three. (Interpolation from DR data; exact LUFS of 90s masters not consistently published.)
- **Modern trance (uplifting/festival/tech-trance)**: club masters commonly −8 to −6 LUFS; festival-oriented masters push to the louder end. Streaming master −14 LUFS.
- **Techno (peak-time/driving, loud club end)**: the loudest of the three in practice. Samplesound's techno-mastering guide states *"around -8 to -6 LUFS is typical for techno… aim for around -8 to -6 LUFS to ensure your track is loud enough for clubs without sacrificing dynamic range."* Some sources/tracks reach −5 LUFS or louder; a minority of engineers deliberately master dance tracks conservatively (−16 LUFS) and let DJs gain up on the club mixer. Streaming master −14 LUFS.
- **Reality check (well-sourced)**: iZotope's analysis of top Billboard dance/electronic tracks (Ian Stewart) found *"most commercial releases being mastered to around -8.3 LUFS, ±1 LU."* The chart-topping "Miles On It" (mastered by Zach Pereyra) measured −6.2 LUFS / LRA 4.8 LU; the most dynamic entry analyzed sat at −11.3 LUFS / LRA 13.8 LU and CHRYSTAL's "The Days" at −10.3 LUFS / LRA 3.5 LU. So "**−6 to −8 LUFS, LRA ~3–5 LU**" is a defensible modern-dance club-master profile, with melodic outliers ranging more dynamic.

#### Loudness Range (LRA, EBU R128) — LU
- **General good range**: 6–12 LU is healthy/dynamic; below 4 LU is static; 3–4 LU is realistic for loop-based dance with a steady beat and only one or two breaks.
- **Techno (driving/peak-time)**: typically very low, ~3–5 LU. Per Lars Lentz Audio, *"Tracks with LRA below 4 LU are considered static in loudness, while those between 6 LU and 12 LU show considerable loudness variation… tracks with a constant drum beat throughout them tend to be around 4 LU for LRA values and that is regardless of compression"* — i.e., this is inherent to the genre, not just over-limiting.
- **Modern trance**: somewhat higher because of breakdowns — interpolated ~4–7 LU (the big breakdown raises LRA versus straight techno).
- **90s/classic trance**: higher still, ~6–10 LU, owing to genuine dynamic contrast between long breakdowns and full sections.
- Caveat: Bob Katz (via Lars Lentz Audio) describes LRA as *"more descriptive rather than prescriptive, meaning that it is not something that you should aim for"* — use it as a flag, not a hard pass/fail.

#### Crest factor / PLR / PSR — dB
- **Definitions (standard)**: Crest factor / DR = peak − RMS (average). PLR = max true peak − integrated LUFS. PSR = true peak − short-term LUFS. A "reasonable crest factor for dynamic material" is ~14 dB; pop/rock/dance often targets ~12 dB crest when not crushed.
- **Measured DR (crest) by genre** (Dynamic Range Database; note it measures crest factor, not peak-to-noise-floor dynamic range):
  - **90s/classic trance**: Paul van Dyk "For an Angel" (1998 CD) = **DR10** (tracks 9–11); "Another Way/Avenue" (1999 CD) = **DR10**; Armin van Buuren debut "76" (2003 CD) = **DR11**. Era center ≈ **DR10–11**.
  - **Modern trance**: Armin van Buuren "A State of Trance 2012/2013" = **DR6–7**; "Intense" (2013) = **DR6**; "Mirage" (2011) = **DR6**; PvD "Evolution" (2012) = **DR5**, "From Then On" (2017) = **DR6**; outlier "Blah Blah Blah EP" (2018) = **DR4**. Center ≈ **DR5–7**.
  - **Techno**: I could not retrieve named-track DR rows for current peak-time artists (Adam Beyer, Charlotte de Witte, Amelie Lens, Layton Giordani, Eli Brown) — the DR-database artist queries returned no results during research. Based on the LUFS targets (−6 to −7), LRA (~3–5 LU), and the DR DB's own guidance that dense electronic material "can still sound okay with DR5," techno crest factor is **~DR5–6 (interpolated; well-corroborated indirectly but not directly measured for these artists)**.
- **PLR**: a healthy dynamic-music PLR is ~13 (e.g., a track at −13.4 LUFS integrated with true peak near 0 shows PLR ~13). For a −6 LUFS club master at −0.1 dBTP, PLR ≈ 6 — i.e., techno/loud club masters have low PLR by design.

#### True peak ceilings
- **Standard**: −1.0 dBTP is the universally recommended ceiling (EBU R128 mandates −1 dBTP max for broadcast; streaming guides recommend the same for music). Spotify recommends −1 dBTP, or **−2 dBTP if the master exceeds −14 LUFS** to avoid lossy-codec distortion. YouTube's AAC encoding adds intersample peaks — another reason to stay at −1.0 dBTP, not 0.
- **Club/CD/DJ masters**: some engineers push to −0.1 dBFS for maximum waveform loudness in DJ software, accepting the codec risk because the file isn't streamed.

### 2. TEMPO (well-established, multiple corroborating sources)

| Genre | Typical BPM range | Ideal center |
|---|---|---|
| 90s/classic trance | 130–140 (broad genre 125–150) | ~135 |
| Modern uplifting/festival trance | 136–142 | ~138–140 |
| Modern progressive/melodic trance | 128–134 | ~132 |
| Techno (overall) | 125–150 | — |
| Techno peak-time/driving | 128–135 (sources vary 126–135) | ~132 |
| Hard techno | 140–150 | ~145 |
| Melodic/dub techno | ~125–128 | ~126 |

Notes: Wikipedia gives trance broadly *"125 to 150 BPM"*, 4/4, with 16/32-beat phrasing. Uplifting trance is most consistently cited at **138 BPM** as its signature tempo (Insomniac/Beatlab cite 136–142). Paul van Dyk's catalog sits ~134–138 BPM (practitioner consensus). Classic dream trance (Robert Miles) and Balearic ~130 BPM. Techno's center of gravity is 130–140, with most peak-time tracks 128–135; sources disagree on whether peak-time centers at 126–132 or 132–135, so the config should treat **~128–135** as the peak-time window.

### 3. SPECTRAL / FREQUENCY BALANCE (rule-of-thumb + interpolation)

There is no published per-genre spectral-centroid dataset for these three styles; iZotope's Tonal Balance Control ships generic "Modern," "Bass Heavy," and "Orchestral" target curves built from thousands of masters, not trance/techno-specific curves. The following is synthesized from genre production guidance and is explicitly a mix of rule-of-thumb and interpolation:

- **Sub-bass / bass (20–120 Hz)**: All three are kick-and-bass-anchored four-on-the-floor. Useful sub bands: subsonic 20–40 Hz (felt, used sparingly), primary sub 40–60 Hz (core thump), upper sub/low bass 60–120 Hz (audible pitch/presence). Kick fundamental commonly ~50–70 Hz, sub ~30–45 Hz.
  - **Techno**: low-end and **mid-forward** character is the defining trait — energy concentrated in kick/bass and a driving low-mid/mid groove, with comparatively less top-end air. Per Wikipedia, in techno (and house) *"the kick drum is heavily emphasized, often being the loudest sound in the mix."*
  - **Trance (both eras)**: de-emphasizes the kick relative to bassline compared to techno/house (Wikipedia: *"in trance the kick drum is often de-emphasized to give space to the bassline"*), and pushes **bright, airy high end** — detuned supersaws, gated/arpeggiated leads, shimmering pads, and high-frequency "sheen." Brightness/spectral-centroid ordering (interpolated): **modern trance ≥ 90s trance > techno**.
- **Kick/bass relationship**: sidechain ("ducking") the bass/pads to the kick is near-universal in trance and techno; cut kick and bass against each other in the 50–120 Hz overlap; a small overlap can add drive.
- **Mid/high**: trance's signature is upper-mid/presence/air emphasis (supersaw stacks with leads at 1–3.5 kHz, high-shelf air at ~8 kHz on the sides). Techno keeps more energy in low-mids/mids (the "tough," percussive, hypnotic body) with crisp but less euphoric highs (909 hats/claps).

### 4. STEREO / IMAGING (rule-of-thumb, strong consensus)

- **Bass mono convention**: keep everything below ~**100 Hz mono** (some sources say 100–150 Hz; Armada Music's tutorial uses **120 Hz** as the kick/bass mono crossover). Stereo-spread sub frequencies cause phase cancellation and weak low end on club/PA mono subs and vinyl. Config default: **mono ≤ 100–120 Hz**.
- **Width strategy**: keep kick, bass, and lead center/mono-strong; widen pads, supersaws, reverb tails, and panned percussion. Trance is generally the **widest** of the three (large detuned supersaw stereo fields, M/S high-shelf air on the sides); techno is **narrower and more centered/punchy** (hats/percussion panned, but the groove kept tight and mono-robust).
- **Mono compatibility is mandatory**: clubs often sum to mono; check correlation and that the mix doesn't collapse. Supersaws in particular must be designed to survive mono (layer a centered/lightly-detuned core under the wide detuned layer). Correlation should stay positive overall; brief excursions toward 0 are acceptable on wide sections, while negative correlation in the bass is a fail.

### 5. ARRANGEMENT (context; lower priority)

- **Track length**: trance tracks typically **6–9 minutes**; techno tracks typically **6–8 minutes (some 10+)**; radio/streaming edits ~3–4 min. All built on **8-bar (and 16/32-bar) phrasing** in 4/4.
- **90s/classic & modern trance structure**: Intro (DJ-friendly, often 32–64 bars, sparse) → build/enticement → main section → **breakdown** (beats drop out, ~16–32 bars, melodic hook and pads foregrounded, filter builds tension) → **build-up** (risers, snare rolls) → **drop/climax** (full melody + drums) → second section → **outro** (32–64 bars, mirrors the intro in reverse for mixing out). The melodic breakdown→build→drop is the genre's emotional signature; modern uplifting trance foreshadows climaxes with lengthy snare rolls.
- **Techno structure**: more **linear and hypnotic**, built on layering and micro-variation rather than big breakdown/drop contrast. Long DJ-friendly intro (30 s–2 min, beat-matchable), gradual layering to a first full groove (often around bar 65), extended hypnotic main section driven by filter/automation, a stripped breakdown, a re-build, and a long outro (~16–64 bars) for mixing. Energy evolves slowly; there is no trance-style euphoric melodic breakdown.

## Recommendations

**Stage 1 — Encode two loudness profiles per genre (do this first):**
- Streaming profile (all genres): integrated −14 LUFS (tolerance ~−13 to −15), true-peak max −1.0 dBTP. Note that Apple is −16 and Deezer −15.
- Club/DJ profile: 90s/classic trance −10 to −8 LUFS; modern trance −8 to −6 LUFS; techno −7 to −6 LUFS (allow down to −5 as "hot"); true peak −1.0 dBTP (or −0.1 dBFS for DJ-only files).

**Stage 2 — Set dynamics thresholds (flag, don't hard-fail):**
- Crest/DR target: 90s trance DR ≈ 9–12 (warn below 8); modern trance DR ≈ 5–8; techno DR ≈ 5–7.
- LRA: techno 3–5 LU; modern trance 4–7 LU; classic trance 6–10 LU. Flag LRA < 3 as "possibly over-limited," except for intentionally static techno.
- PLR: warn if a streaming-targeted master shows PLR < 8 (over-compressed for −14 normalization).

**Stage 3 — Tempo gates:** use the table above; treat out-of-range BPM as a soft genre-mismatch warning, not an error (subgenres legitimately span wide).

**Stage 4 — Spectral/stereo checks:** flag stereo energy below 100–120 Hz (mono-compat fail); flag negative low-frequency correlation; for techno warn on excessive high-end/air relative to mids; for trance warn on thin/dark high end. Treat tonal tilt as relative-to-reference, not absolute.

**Benchmarks that should change the thresholds:** if you build a measured reference-track corpus per genre (run 20–30 pro tracks per style through a BS.1770 meter + DR meter), replace the interpolated crest/LRA/centroid numbers with measured medians and 10th–90th percentiles. If platform targets change (e.g., Spotify moving off −14, or a new club-delivery standard emerging), update the streaming profile.

## Caveats
- **Techno DR/crest values are the weakest-sourced numbers here.** DR-database rows for current peak-time techno artists could not be retrieved (artist queries returned no results), so techno's DR5–6 is inferred from its LUFS/LRA profile and the DR DB's note that dense electronic material is normal at DR5 — not directly measured for named artists. Verify against your own measurements before treating as hard thresholds.
- **DR ≠ true dynamic range.** The DR/crest metric measures peak-to-average, not quiet-to-loud musical contrast; a single transient can inflate it. Use it as a compression indicator, not a quality score.
- **90s LUFS figures are interpolated** from DR/crest data; original 1990s masters predate LUFS metering and were measured later, and reissues/remasters often differ from originals (typically louder), so a "classic" profile should be tied to original-era pressings.
- **Spectral balance has no authoritative per-genre dataset.** The tonal-tilt descriptions are practitioner consensus and interpolation, not measured target curves. iZotope's stock curves are generic, not trance/techno-specific.
- **Sources disagree on**: peak-time techno center (126–132 vs 132–135), uplifting trance range (136–142 vs 138–140), and whether to master dance loud at all (most say master to context; a minority advocate −16 LUFS even for club and let DJs gain up). Store ranges, not single points, where flagged.
- Forum/blog and sample-vendor sources (KVR, Gearspace, Samplesound, WEAPON, etc.) were used for production rules-of-thumb and corroboration only; standards claims rest on EBU/ITU and platform documentation, and the measured DR figures rest on the Dynamic Range Database and iZotope's published analyses.