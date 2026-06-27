# Compile Limiting & Competitive-Loudness Craft: A Technical Mastering Reference for EDM

## TL;DR
- **Hit the ceiling at −1.0 dBTP (true-peak) and pick your loudness by destination, not by ego:** for streaming releases master into the −9 to −7 LUFS-integrated zone for EDM (it survives normalization with density intact), for a dedicated club/DJ master push −8 to −6 LUFS, and for European broadcast hit the formal EBU R128 standard of −23 LUFS / −1 dBTP. The only true PUBLISHED STANDARDS here are EBU R128 (−23 LUFS, −1 dBTP) and ITU-R BS.1770-5's measurement algorithm; the −14 LUFS streaming number and every release time are platform conventions or rules of thumb.
- **Pushing past a platform's normalization target buys you nothing:** Spotify, YouTube, Tidal and Amazon turn loud tracks DOWN to roughly −14 LUFS and Apple to −16 LUFS, so a −6 LUFS master plays at the same loudness as a −14 LUFS one — you only keep the crushed dynamics you traded away.
- **A limiter is a compressor with infinite ratio and effectively zero attack acting as a brickwall;** when you can't hit a loudness target cleanly, the fix is upstream (fix low-end/transients, add saturation/clipping to raise the RMS-to-peak ratio, lower the crest factor) — not more limiter gain, which causes pumping, dulling and distortion.

## Key Findings

1. **The −1.0 dBTP ceiling is a near-universal convention, but only EBU R128's −1 dBTP is a formal standard.** Spotify, Apple, YouTube and Tidal all recommend −1 dBTP; Amazon Music asks for −2 dBTP. For hot masters (louder than −14 LUFS) the community/Spotify rule of thumb is −2 dBTP for extra codec headroom.
2. **ITU-R BS.1770-5 (Nov 2023) is the current measurement standard.** Its true-peak annex specifies attenuate 12.04 dB → 4× oversampling (to 192 kHz) → low-pass → absolute value → convert to dB TP. 4× is the baseline minimum; higher ratios are "preferred." This is why a sample-peak meter misses inter-sample peaks.
3. **EBU R128 is the only hard loudness standard in this guide:** −23 LUFS integrated (±0.5 LU, ±1 LU for live), Maximum True Peak −1 dBTP, measured per ITU-R BS.1770 + EBU Tech 3341. The streaming "−14 LUFS" is a de-facto platform target, NOT a formal standard.
4. **Streaming normalization makes hyper-loud masters pointless on streaming**, but club/festival playback (waveform comparison in DJ software, PA limiters) still rewards dense, loud masters — hence the two-master workflow.
5. **When a target can't be reached cleanly, the limiter is the wrong tool.** The crest factor must be lowered upstream via clipping, saturation, multiband control, transient shaping, or parallel compression.

## Details

### 1. True-Peak Limiting Mechanics

**What a limiter actually is.** Mechanically, a brickwall limiter is a compressor configured with an **infinite (∞:1) ratio and an effectively instantaneous/zero attack**. The infinite ratio means that for any signal above the threshold, the output is held at the threshold regardless of how far the input exceeds it — the excess is attenuated by exactly the amount it goes over (DanielRudrich/SimpleCompressor). The zero attack means no transient is allowed to slip past. Combined, these two settings produce "brickwall" behavior: nothing exceeds the ceiling. A normal compressor with a finite ratio lets some signal through above the threshold; a brickwall limiter does not (Mastering.com; ADSR).

**Why "zero attack" needs lookahead.** A true zero-attack gain change applied the instant a peak arrives produces a sharp discontinuity in the waveform — i.e. it behaves like a clipper and creates distortion ("a 0 dB attack makes the limiter work as a waveshaper," MeldaProduction). The solution is **lookahead**: the limiter delays the audio path by a few milliseconds relative to its detection (sidechain) path, so it "sees the peak coming" and ramps the gain reduction down smoothly *before* the peak arrives, reaching full attenuation exactly when the peak hits (Bob Katz, via Gearspace; SimpleCompressor). This is why lookahead is sometimes called a "negative attack time."

**The four core parameters:**
- **Ceiling (output)**: the absolute maximum output level the limiter will allow, set in dBFS or dBTP. This is the brickwall. Typically −1.0 to −0.1 dBFS/dBTP (iZotope).
- **Threshold / input gain**: lowering the threshold (or raising input gain) drives more signal into the limiter, producing more gain reduction and more loudness. This is the "loudness" control.
- **Release**: how quickly the gain returns to unity after a peak passes. Too short → distortion and pumping; too long → loss of level and "holes" punched in the audio (Sound on Sound; Splice).
- **Lookahead**: the delay (in ms) the limiter uses to anticipate peaks.

**Attack on a brickwall limiter** does not behave like a compressor attack — most limiter attack times are "nearly instant or 0 ms," and the "attack" control on advanced limiters actually blends fast/slow release envelopes or sets the time before the release envelope begins (Sage Audio; KVR/FabFilter discussion).

**Lookahead values (RULE OF THUMB).** A general working range is **1–5 ms** for most music (Number Analytics). Many mastering engineers keep lookahead very low — under 0.3 ms — to preserve transient snap, raising it to 1.5–2 ms only on ballad/piano material where transients matter less (Dana Nielsen, Mix Protégé). Hardware-modeled/DSP limiters often offer fixed steps like 1.5 / 3 / 6 ms (Ableton limiter). For loud EDM, no lookahead or ~1 ms is a common starting point (Stickz). Longer lookahead = cleaner/safer but quieter and softer transients; shorter = louder and punchier but more distortion risk.

**Release values (RULE OF THUMB).** A frequently cited starting point is ~50 ms, with smoother results above 250 ms and "loud-at-all-costs" settings at 5–10 ms (Sage Audio). Pop/rhythm-heavy material often lands 120–300 ms (Mix Protégé). Auto-release is a safe default for amateurs because it adapts the release moment-to-moment (Splice). **Genre/program interaction:** faster release = louder and more "exciting" but pumping and bass distortion risk; slower release = duller but more transparent (Sound on Sound). For four-on-the-floor EDM, syncing release roughly to the beat so gain reduction recovers by the next kick/snare is a common groove trick (Gearspace; Mix Protégé).

**Limiting vs compression vs brickwall.** Compressors use variable ratios (~1.5:1 to ~12:1); limiters use high-to-infinite ratios (often 10:1 to ∞:1); brickwall limiters are fixed at ∞:1 where the gain reduction is governed by the ceiling rather than a ratio knob (Mystic Alankar; Peak-Studios). Many engineers stage two limiters (a lighter tone-shaping one then a true brickwall) and keep total gain reduction modest — roughly 1–5 dB, ideally ≤2.5 dB visible on a single brickwall, to avoid audible artifacts (Mastering.com; Splice).

### 2. Streaming-vs-Club Loudness Distinction

**Streaming normalization targets (CURRENT, verified against official/2025–2026 sources):**

| Platform | Integrated target | Direction | Default on? | User-toggle? | Norm. type |
|---|---|---|---|---|---|
| **Spotify** | **−14 LUFS** (Normal); user-selectable −19 (Quiet), −11 (Loud) | Down always; up only within peak headroom on −14/−19; **limiter used on −11/Loud** | Yes | Yes | Track + Album |
| **Apple Music** | **−16 LUFS** (Sound Check) | Down and up, but never beyond available peak headroom; **never limits** | Yes (new installs) | Yes | Track + Album |
| **YouTube / YT Music** | **−14 LUFS** | Down only | Yes | Effectively no (server-side) | Track |
| **Tidal** | **−14 LUFS** | Down only (turn-down) | Yes | Yes | Album |
| **Amazon Music** | **−14 LUFS** (some sources cite −13) | Down only | Yes | Yes | Track |
| **Deezer** | **−15 LUFS** | Down mostly | No (can't always toggle) | varies | Track |

Spotify's own help doc ("Loudness normalization on Spotify") states verbatim: *"We adjust tracks to -14 dB LUFS, according to the ITU 1770 standard… Negative gain is applied to louder masters so the loudness level is -14 dB LUFS,"* and that it applies positive gain to softer masters while **leaving 1 dB headroom for lossy encodings**, normalizes albums as a unit, and switches to per-track normalization when shuffling/playlisting. Crucially, Spotify's doc confirms the **Loud (−11 LUFS) setting applies a limiter** — verbatim: *"We apply a limiter to prevent distortion and clipping in soft dynamic tracks. The limiter's set to engage at −1 dB (sample values), with a 5 ms attack time and a 100 ms decay time."* iZotope's compilation (Jonathan Wyner) confirms that on the −19 and −14 settings quiet songs are turned up "only as much as peak levels allow," and that limiting is used **only** for −11/Loud — verbatim: *"Limiting will be used for the -11 LUFS setting, however, more than 87% of Spotify users don't change the default setting."*

For Apple Music, iZotope states verbatim: *"Apple Music uses a reference level of -16 LUFS, enables normalization on new installations, will turn quieter songs up only as much as peak levels allow, never uses limiting."* Apple adopted −16 LUFS following the AES TD1008 streaming recommendation (Production Expert, citing Bob Katz & Rob Byers).

**Club/DJ masters: −6 to −8 LUFS integrated (RULE OF THUMB / scene convention).** Multiple mastering sources converge on −6 to −8 LUFS for club/PA material, with the rationale that DJs compare waveforms in DJ software (Rekordbox), festival systems push 110+ dB and have their own PA limiters, and tracks below this feel weak in a mix.

**Why pushing past the target only loses dynamics.** Normalization is a simple gain offset: playback gain = target − measured loudness. A −8 LUFS master on Spotify gets −6 dB applied to land at −14; it now plays at the same loudness as a −14 LUFS master but with the dynamic range you already sacrificed — "the loudness gain is undone… the dynamic range you sacrificed to get loud is gone." The counter-nuance (Soundcamps, others): a loud master that's been turned down still retains the density, saturation and transient energy baked in, so it can *sound* more energetic than a natively quiet master at the same playback level — which is why EDM engineers still master hot, then let the platform turn it down.

### 3. Setting the True-Peak Ceiling

**The −1.0 dBTP convention.** This is the near-universal streaming recommendation and traces directly to EBU R128's formal **Maximum Permitted True Peak Level of −1 dBTP** (a STANDARD). For streaming it's a de-facto convention reinforced by every major platform's docs (Spotify, Apple, YouTube, Tidal all −1 dBTP). −1.0 dBTP gives ~1 dB of headroom for the encoder to add inter-sample peaks without clipping.

**−2 dBTP for hotter masters / lossy headroom (RULE OF THUMB).** Spotify explicitly advises: if a master exceeds −14 LUFS integrated, drop the ceiling to −2 dBTP because "louder tracks are more prone to additional distortion during transcoding." Amazon Music's spec is −2 dBTP across the board, so −2 dBTP is the safest single ceiling if you want one master to satisfy every platform.

**Why ceilings exist:** inter-sample peaks (the reconstructed analog waveform overshooting between samples) and codec overshoot (lossy encoders adding peaks). Both can push a "0 dBFS-clean" file above full scale on playback or after encoding.

**EBU R128 specifics:** the base R128 recommendation sets Max True Peak at −1 dBTP and target −23 LUFS. The **R128 s1** supplement (for short-form content like adverts/promos) keeps −1 dBTP and adds a **Maximum Short-term Loudness Level of −18.0 LUFS** — verbatim from EBU R128 s1: *"the Short-term Loudness Level… shall not exceed −18.0 LUFS (+5.0 LU on the relative scale),"* with a +0.2 LU QC tolerance — because Loudness Range is statistically unreliable on clips under ~1 minute. EBU Tech 3344 notes permitted true-peak maxima may be *lower* for data-reduced distribution.

### 4. Inter-Sample Peaks and Lossy-Codec Considerations

**What ISPs are.** Between two samples both sitting below 0 dBFS, the reconstructed continuous waveform can overshoot above 0 dBFS. A sample-peak meter only reads discrete sample values and therefore misses these inter-sample peaks entirely (Splice; Adrian Milea). In extreme cases ISPs can exceed sample peaks by up to ~3 dB.

**How lossy encoding makes it worse.** MP3, AAC, Ogg Vorbis and Opus discard "perceptually irrelevant" information and reconstruct the signal mathematically at playback; that reconstruction introduces its own inter-sample behavior. A file measuring +0.3 dBTP before encoding "might measure +1.0 dBTP or higher after" (Mat Leffler-Schulman). This is why every platform specifies a true-peak ceiling below 0.

**ITU-R BS.1770 true-peak methodology (STANDARD, BS.1770-5, Nov 2023, Annex 2).** The specified algorithm is: (1) **attenuate 12.04 dB** (2-bit shift, for integer-arithmetic headroom; unnecessary in floating point); (2) **4× oversampling** (48 kHz → 192 kHz); (3) **low-pass filter** (48-tap, 4-phase FIR); (4) **absolute value**; (5) **convert to dB TP** via 20·log10 then add back the 12.04 dB. The standard states meters "should… use an oversampled sampling rate of at least 192 kHz," and that **4× is the baseline with higher ratios "preferred"** (worst-case under-read at 4× is ~0.5–0.7 dB; at 8× ~0.14–0.17 dB). The unit "**dB TP**" signifies "decibels relative to 100% full scale, true-peak measurement." 96 kHz material needs only 2× oversampling. The 12.04 dB headroom design means true-peak readings can legitimately exceed 0 dBFS. BS.1770-5 (2023) added immersive/object-based audio support (new Annex 4) but left the true-peak annex substantively unchanged from BS.1770-4 (2015).

**Recommended ceiling for lossy destinations:** −1.0 dBTP minimum; −2.0 dBTP for hot masters or to cover Amazon and aggressive transcodes. Some engineers use −1.5 dBTP as a middle-ground safety margin.

### 5. Loudness Standards — Precise Citations

**EBU R128 (STANDARD; current v5.0, Nov 2023; first issued Aug 2010):**
- Integrated loudness target: **−23.0 LUFS** (Programme Loudness), deviation ≤ ±0.5 LU generally, ±1.0 LU for live/unpredictable material.
- Maximum True Peak Level: **−1 dBTP** — verbatim from EBU R128: *"the True Peak Level of the programme shall not exceed −1 dBTP (dB True Peak) for linear audio, measured with a meter compliant with ITU-R BS.1770 and EBU Tech 3341."*
- **LRA (Loudness Range)**, per EBU Tech 3342: the difference between the 10th and 95th percentiles of the 3 s short-term loudness distribution after gating; typically 5–20 LU for broadcast.
- **EBU Mode** meter (EBU Tech 3341): standardizes Momentary (M, 400 ms window), Short-term (S, 3 s window) and Integrated (I) displays plus the true-peak indicator, referenced to the EBU +9 scale where 0 LU = −23 LUFS.
- Gating: absolute gate at −70 LUFS, relative gate 10 LU below the ungated level (per ITU-R BS.1770).
- **R128 s1** (short-form): −23 LUFS target, Max Short-term −18.0 LUFS, −1 dBTP.

**ITU-R BS.1770-5 (STANDARD; the measurement ruler):**
- Algorithm: **K-weighting** (a ~+4 dB high shelf above ~2 kHz plus a high-pass around the low end, approximating ear response) → mean-square per channel → channel-weighted summation (surround weighted higher, LFE excluded) → **gating** of 400 ms blocks overlapping 75%, with absolute (−70 LKFS) and relative (−10 LU) thresholds.
- True-peak measurement: Annex 2 (4× oversampling minimum, detailed in §4 above).

**Units:**
- **LUFS** = Loudness Units relative to Full Scale (absolute). **LKFS** (Loudness, K-weighted, relative to Full Scale) is the ITU term and is **numerically identical** — per the standard, "an increase in the level of a signal by 1 dB will cause the loudness reading to increase by 1 LKFS." EBU uses LUFS for naming-convention compliance; 1 LKFS = 1 LUFS.
- **LU** = Loudness Unit, used for relative measurements (1 LU = 1 dB change).
- **dBTP** = decibels true-peak relative to full scale.

**Broadcast −23 LUFS vs streaming −14 LUFS.** −23 LUFS is a formal, often legally-enforced broadcast STANDARD (and the US analog, ATSC A/85, targets −24 LKFS, mandated by the CALM Act signed into law in 2010). The streaming −14 LUFS figure is a **de-facto platform convention**, not a formal standard — platforms normalize *playback* to it but never require masters to be made at it. Streaming targets are louder than broadcast because of the listening environment (phones/earbuds in noisy places favor denser signals).

### 6. Final Makeup Trim

After the brickwall limiter, a **final output gain / makeup trim** stage sets the exact delivered level. In practice the limiter's *ceiling* fixes the peak, and the *threshold/input gain* drives loudness, so the integrated LUFS is hit by adjusting input drive until a compliant LUFS meter (measuring the whole track) reads the target — then the output ceiling guarantees the peak stays at −1.0 dBTP. To hit a precise integrated LUFS: render, measure integrated LUFS, and apply a linear output-gain trim equal to (target − measured). Because this is pure linear gain it is mathematically lossless on 24/32-bit files (LoudFix). For broadcast you can simply normalize the finished master to −23 LUFS and verify true peak stays ≤ −1 dBTP, applying a safety limiter only if a stray peak exceeds it.

### 7. The Fan-Out Cases — When the Target Can't Be Reached Cleanly

**Recognizing the problem:** if you need 6–10 dB of gain reduction just to feel competitive, or the mix "crumbles"/distorts when you push the limiter, the limiter is being overdriven and the fix is upstream (Futch; Mix Protégé).

**Signs the limiter is overdriven:** pumping (audible level surges, especially noise/ambience rising between transients), distortion/"crumbling" on loud sections, loss of punch (flattened transients), and a dull/brittle, fatiguing tone (Sound on Sound; Mastering The Mix; MeldaProduction).

**Fix dynamics before the limiter:**
- **Uncontrolled low end** is the #1 culprit — sub energy below ~60 Hz makes the limiter pump and eats headroom. Keep sub mono below ~80 Hz, high-pass below ~30 Hz, and use dynamic EQ to tame resonant bass notes (Venia; Mastering The Mix).
- **Excessive transients / poor gain staging** — tame with transient shaping or clipping before limiting.

**Add harmonic density / saturation to raise the RMS-to-peak ratio.** Saturation and soft clipping add harmonics and reduce peak height while maintaining or raising perceived loudness, letting you push louder before the limiter destroys transients. This raises average level relative to peaks (lowers crest factor) (Song Mix Master).

**Dealing with crest factor.** Crest factor = peak-minus-average (dB); a balanced master target is roughly 8–12 dB (Song Mix Master). When crest factor is too high to hit competitive loudness cleanly, lower it upstream with: **clipping** (chops fast peaks before the limiter — "clipping + limiting = louder masters with fewer trade-offs"), **soft saturation**, **multiband compression/dynamics** (so a loud kick doesn't duck the whole spectrum), **transient shaping**, and **parallel compression** (adds density/sustain without killing transient contrast). The principle: do the loudness work in stages upstream so the brickwall only has to catch the last 1–3 dB.

### 8. Exact Starting-Value Parameter Tables

**Note on labels:** STANDARD = formally published; PLATFORM = de-facto platform target; ROT = community rule of thumb.

**Table A — By Delivery Context**

| Context | Ceiling | Threshold approach | Release (start) | Lookahead | Integrated LUFS |
|---|---|---|---|---|---|
| **Streaming master (EDM)** | −1.0 dBTP (PLATFORM); −2.0 if hot | Drive input until LUFS target hit; keep GR ≤ ~3 dB on brickwall | 50–150 ms or auto (ROT) | 1 ms (ROT) | −9 to −7 LUFS for EDM (ROT); −14 if maximizing dynamics |
| **Club / DJ master** | −0.1 to −1.0 dBTP (ROT) | Drive harder; clipper + limiter in stages | beat-synced, ~50–250 ms (ROT) | 0–1 ms (ROT) | −8 to −6 LUFS (ROT) |
| **Broadcast (EBU R128)** | **−1 dBTP (STANDARD)** | Gentle; loudness-leveling not maximizing | 100–400 ms / transparent (ROT) | 1–5 ms (ROT) | **−23 LUFS (STANDARD), ±0.5 LU** |

**Table B — By EDM Genre (LUFS = streaming master starting points; all genre LUFS values are RULES OF THUMB)**

| Genre | Streaming LUFS (ROT) | Club LUFS (ROT) | Release start | Genre limiting notes |
|---|---|---|---|---|
| **House / Tech House** | −9 to −7 | −7 to −6 | beat-synced 100–250 ms | Control low-end; preserve kick/bass groove and sidechain pump |
| **Techno** | −9 to −7 | −8 to −6 | medium, groove-synced | Long-form listening favors slightly more dynamics; tame mono sub |
| **Trance / Melodic / Progressive** | −9 to −8 | −7 to −6 | medium-slow to preserve builds | Protect breakdown-to-drop contrast (~4–6 dB); don't flatten supersaws |
| **Big-room / Festival EDM** | −8 to −6 | −6 to −5 | fast-medium, kick-synced | Loudest cluster; relies on clipping + saturation upstream; preserve drop impact |
| **Drum & Bass** | −8 to −6 (often −7) | −6 to −4 | fast, transient-aware | Transient-heavy; needs careful lookahead/clipping; commonly mastered very hot |
| **Dubstep / Bass** | −8 to −6 | −6 to −4 | fast, transient-aware | Aggressive transients and sub; multiband + clipping before brickwall; watch mono sub |

EDM is one of the loudest genres in electronic music. As a real-world benchmark, Mastering The Mix's analysis of the 25 most-streamed Spotify tracks of 2022 found an average of −8.4 LUFS integrated, with loudest sections (choruses) averaging −6.1 LUFS short-term and some peaking near −4.0 LUFS short-term (Harry Styles' "As It Was" measured roughly −5.6 LUFS integrated). Proper masters still preserve a 4–6 dB difference between breakdown and drop and build loudness from arrangement and saturation, not just limiter gain.

## Recommendations

**Stage 1 — Mix/pre-master gain staging.** Deliver a mix peaking around −6 dBFS with controlled low end (mono sub <80 Hz, HPF <30 Hz). Benchmark to change course: if you need >6 dB of limiter gain reduction to reach target, stop and fix the mix/crest factor first.

**Stage 2 — Pick destination and set the ceiling.** Streaming-only EDM: −1.0 dBTP, master to −9 to −7 LUFS (it survives normalization with density intact). If you'll also service DJs, make a second club master at −8 to −6 LUFS, −0.1 to −1.0 dBTP. If targeting Amazon or want one universal master, use −2.0 dBTP. Broadcast: −23 LUFS / −1 dBTP, non-negotiable.

**Stage 3 — Stage your loudness tools.** Use clipping/saturation/multiband upstream to lower crest factor, then a brickwall limiter doing ≤3 dB. Start lookahead ~1 ms, release 50–150 ms (or auto), true-peak/oversampling ON. Benchmark: if pumping/distortion appears, slow the release and/or back off input gain 0.5–1 dB; if transients dull, raise lookahead slightly and lengthen attack.

**Stage 4 — Final trim and verify.** Render, measure integrated LUFS over the whole track with a BS.1770-compliant meter, apply a linear output trim of (target − measured), and confirm true peak ≤ ceiling after encoding (preview an Ogg Vorbis/AAC encode).

**When to deviate:** if the music is sparse/sub-driven club material, trust your ears and a reference track over the LUFS number — LUFS under-weights sub-bass and can mislead. For very dynamic/melodic work, master quieter (−10 to −14) and let dynamics breathe.

## Caveats
- **Platform numbers drift.** All streaming targets are platform conventions, verified against 2025–2026 sources, but they are not standards and have changed before (Apple adopting Sound Check by default; Spotify's selectable levels). Re-verify against official help docs before a release. Amazon Music is variously reported at −13 and −14 LUFS; treat −14 LUFS / −2 dBTP as the safe assumption.
- **Only EBU R128 (−23 LUFS, −1 dBTP) and ITU-R BS.1770-5 are formal standards** in this document. The −14 LUFS streaming figure, the −1 dBTP streaming ceiling, and every release/lookahead/genre LUFS value are conventions or rules of thumb and should be adjusted by ear.
- **Genre LUFS ranges vary widely by artist and label;** published commercial tracks span roughly −4 to −12 LUFS even within one genre. Always confirm label submission specs, which sometimes mandate a specific master loudness.
- **LUFS is an imperfect ruler for club music** because K-weighting discounts sub-bass; an orthodox sub-driven techno track may be impossible to push to a high LUFS without pathological distortion, so RMS and reference-track comparison remain useful complements.