# The EDM Mixing Assistant's Reference: Compression, Gating & Gain-Staging Craft

*A DAW-agnostic, standards-aware field manual. All numeric values are STARTING POINTS to dial in by ear, not laws. Where a value is a measurement STANDARD it is flagged [STANDARD]; where it is a convention or starting point it is flagged [RULE-OF-THUMB].*

## TL;DR
- **Attack time is the punch control, and it works backwards from intuition:** a *fast* attack clamps the transient and can KILL punch, while a *slower* attack (≈10–30 ms) lets the transient through and ADDS punch. Set attack/ratio/threshold to the JOB (punch, glue, or peak control), keep gain reduction modest (3–6 dB on tracks, 1–3 dB on the mix bus), and gain-match before every A/B so "louder" doesn't fool you into over-processing.
- **Diagnose over-compression with numbers, not vibes:** measure crest factor (peak-minus-RMS) and EBU R128 Loudness Range (LRA) [STANDARD]. Unprocessed drums run ~16–18 dB crest; well-balanced masters often sit ~8–12 dB; collapse toward ~3–6 dB (or PLR ~5 dB) means you've crushed it. When a mix sounds wrong, the fix is almost always LESS processing — raise threshold, lower ratio, remove a comp, or go parallel.
- **Genre sets the dynamics budget:** techno tolerates tighter, more constant compression and a prominent relentless kick; trance/progressive need more breathing room to protect breakdown-to-drop contrast. Sidechain "pumping" (kick ducking bass/pads) is the signature EDM dynamics move — fast attack, release timed to tempo.

---

## Key Findings

1. **The single most important and counterintuitive lesson:** on percussive material a fast attack reduces punch; a slower attack preserves/enhances it. Joe Gilder (ProSoundWeb) bluntly relays the maxim "fast attack times kill music" and recommends dialing back from 5–10 ms to 50–75 ms to "let those transients through." The first ~10–30 ms of a drum hit contains the percussive "snap" your ear reads as punch.
2. **Less is more on the bus.** The SSL-style bus-compression tradition targets only 1–4 dB of gain reduction with a low ratio (2:1), slow-ish attack (10–30 ms) and Auto release. Pushing past ~4 dB "is actively ruining things" (Nail The Mix), bleeding punch out of kick and snare.
3. **Gain staging is a sweet-spot problem, not a clipping problem.** The −18 dBFS = 0 VU convention [the −18 dBFS↔0 VU↔+4 dBu alignment is a STANDARD; the "aim for −18" mixing target is RULE-OF-THUMB] exists because analog-modeled plugins are built to "wake up" around that level. Trim before the compressor; gain-match on bypass.
4. **EBU R128 / ITU-R BS.1770 give you objective dynamics meters** [STANDARD]. LRA quantifies macro-dynamic spread; a collapsed LRA signals over-compression. Crest factor / PLR quantify micro-dynamics (transient health).
5. **Sidechain compression is structural in EDM**, not just corrective — fast attack, threshold low enough for 3–6 dB ducking, release timed to the groove.

---

## Details

### 1. Compression Fundamentals & Parameter Craft

**What the controls do, mechanically.**
- **Threshold:** the level above which gain reduction begins. Lower threshold = more of the signal compressed.
- **Ratio:** how hard the over-threshold signal is reduced. 2:1 = gentle (every 2 dB over becomes 1 dB out); 4:1 = moderate; 8:1–10:1 = aggressive; ∞:1 (or >20:1) = limiting.
- **Attack:** time to reach full gain reduction after the signal crosses threshold.
- **Release:** time to return to no gain reduction after the signal drops below threshold.
- **Knee:** how abruptly compression engages around the threshold (hard = sudden/aggressive, soft = gradual/transparent).
- **Makeup gain:** level added back after compression to restore perceived loudness.

**Attack — how it preserves vs destroys transients (the crucial mechanism).** When the transient (the loudest, fastest first part of a drum/pluck) crosses the threshold, the compressor begins reducing gain. With a **fast attack (<1–5 ms)** the comp clamps that transient *immediately*, flattening the very spike your ear reads as "punch" — the drum sounds smaller, duller, more "pushed back." With a **slower attack (≈10–30 ms)** the transient passes through *before* gain reduction engages; the comp then acts on the body/sustain that follows. The counterintuitive consequence: **fast attack can KILL punch; slower attack can ADD punch** because it actually *increases* the contrast between the preserved transient peak and the reduced sustain that follows. As Sound on Sound's Mike Senior explains, a fast attack paired with a fast release "de-emphasises" the transient relative to the sustain, whereas pairing a slow attack with appropriate release keeps the transient/sustain balance intact or enhanced. The ~30 ms figure recurs because that is roughly "the window of time in which the punchiness of a sound really makes itself known" (Pro Audio Files) — which is also why many classic compressors top out at 30 ms attack.

*When a FAST attack is correct:* taming a genuinely too-loud transient (a slappy bass, an over-poky snare), leveling erratic vocal consonants, or adding "weight/sustain" by deliberately suppressing the snap. Note: fast attack on bass/low frequencies can cause distortion — use a sidechain high-pass or slower attack.

**Release — timing, groove, pumping.** Release should generally be set so the gain-reduction meter "just barely returns to zero before the next transient" (Mastering The Mix). Too *fast* a release on sustained/low material causes distortion or an audible swell-up; too *slow* and gain reduction accumulates, dulling the sound and causing "breathing." Release interacts directly with tempo: matched to the beat, the comp "breathes" musically; mismatched, you get unintentional pumping. **Intentional pumping** (the EDM sound) comes from a release tuned to the bar/beat. **Auto / program-dependent release** (as on the SSL bus comp) varies release with the material and is the safest default for complex/bus material.

**Knee.** Hard knee = compression hits fully and abruptly at threshold → aggressive, audible, good for transient control on drums, limiting, and predictable peak catching. Soft knee = compression eases in gradually starting below threshold → transparent, "musical," good for vocals, acoustic sources, bus glue and mastering. Many classic optical units (LA-2A) are inherently soft-knee, which is why they sound smooth even at heavy gain reduction. Rule of thumb: dial threshold/ratio/attack/release first, then use knee to set how *obvious* the compression feels.

**Three goals, three setups.**
- **PUNCH** (kick, snare, clap): slow-ish attack to pass the transient, fast/medium release to reset before the next hit, moderate ratio, hard-ish knee.
- **GLUE** (groups, mix bus): low ratio, slow attack, Auto/medium release, soft knee, tiny GR.
- **PEAK CONTROL / limiting:** fast attack, high ratio (8:1–∞:1), fast release, threshold near peaks; catches spikes only.

#### TABLE 1 — Compression starting points by use case [all RULE-OF-THUMB starting values]

| Use case | Goal | Threshold (approach) | Ratio | Attack | Release | Knee | Target GR | Makeup |
|---|---|---|---|---|---|---|---|---|
| **Kick (punch)** | Punch | Set for 3–6 dB GR on hits | 4:1 (push 6:1–8:1 for EDM/hip-hop consistency) | 10–30 ms (slow lets click through) | 50–150 ms (reset before next hit) | Hard (3–6 dB) | 3–6 dB | to unity |
| **Snare / clap (punch)** | Punch | Catch each hit, not the tail | 4:1–6:1 | 1–5 ms if taming snap; 10–30 ms if enhancing punch | ~80–150 ms | Hard | 3–6 dB | to unity |
| **Bass (control)** | Consistency | 4–6 dB GR | 3:1–4:1 | 10–40 ms (preserve pluck) | 50–120 ms (avoid low-end pumping) | Soft | 3–6 dB | to unity |
| **Vocal / lead (control)** | Evenness | 3–6 dB GR | 3:1–4:1 (up to 6:1 rap) | 5–15 ms (slower if odd) | 40–200 ms (breathe with phrasing) | Soft | 3–6 dB | to unity |
| **Bus / group (glue)** | Cohesion | 1–3 dB GR only | 1.5:1–2:1 | 10–30 ms | Auto or ~0.3 s | Soft | 1–3 dB | to unity |
| **Peak control / limiting** | Catch spikes | At/near peaks | 8:1–∞:1 | <1 ms (fast) | fast–medium | Hard | only on peaks | careful |

> Caveat: low ratios (2:1) are inherently less "punchy" than higher ratios, but a high ratio with a very fast attack is the *least* punchy of all — it just sounds dull. Match attack to transient speed: faster transients (drums) tolerate faster attacks; slower transients (pads, vocals) need slower attacks.

### 2. Mix-Bus "Glue" Compression Conventions

The "glue compressor" tradition descends from the **SSL G-series bus compressor** [the unit is a specific historical reference; the settings are RULE-OF-THUMB]. The original hardware offered only three ratios (2:1, 4:1, 10:1), six attack times (0.1, 0.3, 1, 3, 10, 30 ms) and four release options (0.1, 0.3, 0.6, 1.2 s) plus **Auto** — a program-dependent, multi-stage release "optimized for program material" (Universal Audio).

Widely cited glue starting point: **ratio 2:1, attack 10–30 ms, release Auto, aiming for 1–3 dB (max ~4 dB) of gain reduction.** A sidechain high-pass filter around 80–150 Hz stops the kick from over-triggering the comp on bass-heavy EDM material (Fab Dupont demonstrates ~30–40 Hz to "very low," ~8 o'clock, on the SSL). The 2:1 ratio is "the most transparent"; 10:1 gives a "harder sound often desired for drum groups."

**"Less is more" and why.** Multiple pro sources converge on 1–3 dB GR on the master bus. Andrew Wade (Nail The Mix): aim for 2–3 dB on loudest sections; past 4 dB "you are actively ruining things… you'll start to lose the punch of your kick and snare, and that damage can't be undone in mastering." The mix bus sums every track, so a little gain reduction there has a large cumulative effect on the whole record's transient life. A crucial workflow warning from the same source: **don't mix into a master-bus limiter** — it skews your perception and makes you chase your tail; turn it off and you're left with an unbalanced mix.

#### TABLE 2 — Mix-bus / glue starting points [RULE-OF-THUMB]
| Parameter | Setting | Why |
|---|---|---|
| Ratio | 1.5:1–2:1 | Smooth, not tame |
| Attack | 10–30 ms (often 30) | Lets transients through |
| Release | Auto or ~0.3 s | Breathes with program |
| Gain reduction | 1–3 dB (≤4 dB) | Preserves punch/dynamics |
| Knee | Soft | Transparent |
| Sidechain HPF | 80–150 Hz | Kick stops over-triggering |

### 3. Noise Gates — Bleed, Hum & Tails

A gate is the inverse of a compressor: it attenuates signal *below* the threshold instead of above it. Controls:
- **Threshold:** level above which the gate opens. Set just below the quietest wanted hit, above the loudest bleed/noise.
- **Attack:** how fast the gate opens once threshold is exceeded. Fast (<1–5 ms) for drums so the transient isn't clipped; slower (5–15 ms) for vocals so word-starts aren't chopped.
- **Hold:** minimum time the gate stays open — prevents "chatter" (rapid open/close on fluctuating signal). Often 20–30 ms minimum.
- **Release (decay):** how fast the gate closes after the signal falls below threshold (or after hold). Tune to the natural decay of the source and the tempo.
- **Range / floor (depth):** how much the signal is attenuated when closed. Full silence is often wrong; a partial range (e.g. 10–20 dB) sounds more natural and leaves some life. ~18 dB "generally makes signals below threshold inaudible" (Collaborate Worship).
- **Key/sidechain filter:** lets the gate "listen" to only a frequency band so, e.g., hi-hat bleed doesn't open a snare gate (target ~250 Hz for snare; HPF ~200 Hz + LPF ~4 kHz to focus a kick).

**Function difference vs a compressor:** on a compressor, attack/release shape how it *clamps down* on loud material; on a gate they shape how it *opens and closes* around quiet material. A gate's "range" is analogous to (but opposite in direction from) a compressor's effect depth.

**Hard gate vs expander.** A hard gate slams to its range/floor (effectively very high ratio, 100:1+). A **downward expander** gently turns *down* quiet material by a low ratio (e.g. 2:1) instead of cutting it — far more natural for noise-floor and bleed reduction where a hard gate would sound choppy. Prefer the expander when you want to *reduce* rather than *eliminate* bleed/tails.

#### TABLE 3 — Gate / expander starting points [RULE-OF-THUMB]
| Use case | Threshold | Attack | Hold | Release | Range/floor |
|---|---|---|---|---|---|
| **Kick (bleed)** | Just below kick peak, above bleed | 0–1 ms | 20–40 ms | 50–150 ms | full, or −20 dB for natural |
| **Snare (bleed)** | Above hi-hat bleed (use key filter ~250 Hz) | 0–1 ms | 20–30 ms | 50–150 ms | ~10 dB for decay to show |
| **Toms** | Above cymbal spill | 0–1 ms | 20–40 ms | tune to next hit | full or near-full |
| **Synth/vocal hum & noise floor** | Just above noise | 5–15 ms | 20–50 ms | 100–300 ms | 10–20 dB (expander preferred) |
| **Reverb/delay tail control** | Above tail level | fast | to taste | tune to musical gap | partial |

Starting threshold tip: begin fully closed and lower threshold until only the wanted signal opens it; or start at −40 dB and adjust. If it chatters, raise hold; if it clips the start of notes, make attack faster or threshold lower.

### 4. Trim-Based Gain Staging

**The −18 dBFS = 0 VU convention.** In the analog era, 0 VU corresponded to a nominal operating level (+4 dBu in pro gear). When the industry mapped that to digital, the rough consensus became **−18 dBFS ≈ 0 VU** [this mapping is a STANDARD alignment; "aim for −18 dBFS average" as a mixing target is RULE-OF-THUMB]. Analog-modeled plugins (1176, LA-2A, Pultec, SSL, Neve emulations) are built to behave correctly when fed roughly this level — too hot and they over-react/distort; too quiet and their harmonic "character" never engages. Clean digital EQ/dynamics are level-linear and don't care.

**Targets** [RULE-OF-THUMB]:
- Per-track average (RMS): ≈ −18 dBFS (peaks ≈ −10 to −12 dBFS).
- Mix-bus peaks: ≈ −6 dBFS (leave headroom for mastering).
- Master true peak: ≤ −1 dBTP [STANDARD ceiling per EBU R128 / streaming].
- Faders within ±5 dB of unity — if a fader is at −20 or +6 dB, fix upstream with trim/clip gain.

**Order of operations.**
1. **Trim BEFORE the compressor** (a gain utility as first insert, or clip/region gain) so every channel hits the compressor in its sweet spot and so poorly recorded levels are fixed before processing.
2. Build a static balance with faders near unity.
3. After each compressor, use **makeup gain to match output to input** so an A/B with bypass compares *tone and dynamics, not loudness*.

**Why it matters.** Gain staging (a) puts plugins in their design range, (b) preserves headroom so the master doesn't clip from cumulative "gain creep," and (c) keeps the noise floor down. **Unity-gain / level-matched bypass is the antidote to the "louder sounds better" bias** — the single most common reason amateurs over-compress is that compression + makeup gain makes the processed version louder, and louder *seems* better on first listen. Always match loudness before judging.

### 5. Recognizing & Reversing Over-Compression *(crucial)*

**Symptoms (by ear).** Loss of punch (dull kick/snare, no "snap"); flattened dynamics (verse and chorus hit at the same intensity, "nothing breathes"); pumping/breathing (audible level surges, and background noise rising/falling); distortion (especially on bass/low end from too-fast release); a lifeless, "squashed," fatiguing sound. Note: even **3 dB of gain reduction can pump audibly** if attack/release are wrong — over-compression is not only about *amount* (Digido / Bob Katz; Mastering The Mix).

**Diagnose with numbers.**

***Crest factor*** = peak level minus RMS (average) level, in dB — i.e. how "peaky"/transient-rich the signal is. (Mathematically the ratio peak ÷ RMS; in dB, 20·log of that ratio.) The theoretical floor for a pure sine wave is 3.01 dB (ratio 1.414); for a square/DC waveform, 0 dB. Reference ranges, anchored to iZotope's "What Is Crest Factor and Why Is It Important?" plus mastering literature:
- **Unprocessed drum recording: ≈ 16–18 dB** crest — iZotope states "an unprocessed drum recording… could easily have a crest factor of 16–18 dB."
- **Legato strings, no processing: ≈ 6–8 dB** (low because little transient content) — iZotope: "a legato string quartet with no dynamics processing could have a rather low crest factor of 6–8 dB."
- **Typical full music mix: ≈ 10–20 dB** (DPA Microphones; ProSoundWeb cites 10–20 dB).
- **Well-balanced masters: iZotope notes "masters with a crest factor between 8–12 dB work well,"** with sparser verses/solos hovering 12–15 dB and denser stacked sections coming down to 9–12 dB.
- **Heavily over-compressed / brick-walled material:** iZotope warns "for contemporary pop and EDM releases, it's not uncommon to see crest factors of 5 or even as low as 3 dB." Bob Katz measured one "smashed CD" at **PLR ≈ 5 dB** (Tape Op #116): "at left is a smashed CD with a very high average loudness of -5 LUFS… Its PLR [peak to loudness ratio] is only 5 dB!"

A falling crest-factor reading as you add compression is a direct, real-time warning that you're flattening transients. (Some engineers build a peak-vs-RMS "crest" meter or use a dynamic-range/DR meter to watch this.)

***PLR (peak-to-loudness ratio)*** is the modern, loudness-referenced cousin: true-peak minus integrated LUFS. Bob Katz's guidance (Digido.com), verbatim: **"If the peak to loudness ratio (PLR) of your mix is above 10 dB (LU), more typically above 12 or even 13-14 dB, then you likely have a candidate for a good mix. The sound is the key of course, the PLR is just a guide."** Treat it as a guide, not a target — the sound is the arbiter.

***Loudness Range (LRA)*** [STANDARD: EBU R128 / EBU Tech 3342, built on ITU-R BS.1770] measures the macro-dynamic spread of a whole program in LU — statistically, the difference between the 10th and 95th percentiles of short-term (3 s) loudness after gating. A **collapsed LRA** means sections no longer contrast — a hallmark of over-compression/over-limiting. Broadcast content typically targets 5–20 LU; for dancefloor EDM a tighter LRA is normal and even desirable, but driving it to near-zero kills the build→drop payoff. (Important nuance from the literature: LRA is "descriptive rather than prescriptive" — Bob Katz — and the EBU explicitly warns LRA "should not be confused with dynamic range or crest factor." Use LRA for section-to-section dynamics, crest/PLR for transient health.)

**The core principle: when it sounds wrong, do LESS.** The fix list, in order: raise the threshold; lower the ratio; shorten the chain (remove a compressor); fix the release time to match tempo; or replace heavy serial compression with **parallel compression**. And sometimes the professional move is to **bypass the compressor entirely** — not everything needs it (Dan Murtagh).

**Parallel (New York) compression** — density without killing transients. Blend a heavily compressed copy *underneath* the dry signal: the dry track keeps all transients/dynamics; the crushed copy fills in sustain, body and perceived loudness in the gaps. Setup [RULE-OF-THUMB]: aux/return bus, **ratio 8:1–20:1 (or ∞:1), fast attack (0.1–1 ms), release ~60–120 ms (tempo-matched), 10–18 dB GR on the parallel bus**, then bring the parallel fader up from silence until the drums gain weight — typically sitting **6–12 dB below the dry bus.** High-pass the parallel bus ~100–300 Hz so exaggerated low end/kick bleed doesn't pump the comp. Andrew Scheps and Chris Lord-Alge are well-known advocates.

**Diagnostic workflow:**
1. Gain-match and bypass — is the uncompressed version actually more alive?
2. Measure crest factor / PLR and LRA; compare to the ranges above.
3. If crest has collapsed toward ~3–6 dB or LRA is near-flat (and you didn't intend it), identify the culprit comp (watch which GR meter sits pinned and never returns to zero — "if it's constantly sitting at 6 dB or more and barely returning to zero, that's your problem").
4. Back off (threshold up / ratio down / remove) or convert to parallel.

### 6. Genre-Specific Dynamics Expectations

The dynamics "budget" differs by subgenre [all RULE-OF-THUMB conventions; the only STANDARD here is the LUFS/LRA *measurement* method, not the targets].

- **Techno:** relentless, driving, consistent. Tolerates **tighter compression** and a constant, prominent kick; groove comes from tight, controlled dynamics. Bus/master compression can be more assertive; sub-bass is often kept controlled (club subs run near max anyway). Club masters frequently sit very loud — analyses of top commercial tracks bear this out: Sean Kim, citing Teknup's measurements, notes "the top 25 tracks on Spotify average -8.4 LUFS… nearly 6 dB louder than Spotify's own -14 LUFS target." But on streaming this is normalized down, so density should be earned in the mix, not stamped on by a limiter.
- **Trance / progressive:** built on **contrast** — breakdowns, builds, emotional swells, big drops. Needs **more breathing room**; over-compression on the bus kills the build→drop impact. Use lighter glue (1.5:1–2:1, 2–3 dB), and protect dynamic contrast between sections. Steve Allen (TranceProducer): kick fast attack 1–5 ms / fast release 50–100 ms / 4:1–6:1 / 3–6 dB; "don't add make-up gain beyond what the track actually needs."
- **House / tech house:** four-on-the-floor groove, classic sidechain pump on bass/pads; moderate compression, dancefloor-loud masters.
- **Dubstep / bass music:** heavy compression and **parallel compression on drops**; aggressive multiband (the "OTT" sound) is genre-defining; very loud, low-crest masters by design.
- **Drum & bass:** heavy compression, very fast transients, tightly controlled low end; loud masters.
- **Future bass:** exaggerated, obvious sidechain "sucking" pump on lush chord stacks; heavy multiband.

**Loudness targets by genre** [the platform normalization figures are STANDARD platform settings built on the ITU-R BS.1770 measurement STANDARD; competitive genre mastering levels are RULE-OF-THUMB]: streaming services normalize playback per platform — **Spotify −14 LUFS** (Spotify for Artists states verbatim: "We adjust tracks to -14 dB LUFS, according to the ITU 1770 standard"), **Apple Music −16 LUFS**, **Deezer −15 LUFS**, **YouTube / Tidal / Amazon −14 LUFS** (per iZotope's streaming-mastering guidance). EDM/dance masters are routinely made far hotter (−4 to −9 LUFS is commonly reported for dubstep/EDM), but on a normalizing platform that extra loudness is simply turned down — so chasing −7/−8 LUFS for "loudness" buys nothing on Spotify and only costs dynamic range. Mixmaster guidance for EDM-on-Spotify: target ~−14 LUFS integrated, −1 dBTP, ~4–8 LU dynamic range, and preserve the kick-sidechain ducking through mastering.

### 7. Sidechain Compression *(essential in EDM)*

The signature EDM move: the **kick triggers gain reduction on the bass/pads** so each kick "punches a hole" in the low end (corrective) or so the whole track audibly pumps to the beat (creative). A compressor is placed on the *bass/pad* track; its sidechain/key input "listens" to the *kick*.

#### TABLE 4 — Sidechain starting points [RULE-OF-THUMB]
| Use | Threshold | Ratio | Attack | Release | GR |
|---|---|---|---|---|---|
| **Kick→bass (clarity)** | Low enough for 3–6 dB duck | 4:1 (subtle 2:1–3:1) | Fast (0.1–2 ms) | 20–75 ms, or tempo-timed | 3–6 dB |
| **Kick→pads/synths (pump)** | Lower for obvious effect | 4:1+ | Fast / 0 ms | Timed to beat (¼ or ⅛ note) for groove | 6 dB+ |
| **Vocal→music (duck)** | For 1–3 dB | 2:1 | Fast | <30–50 ms | 1–3 dB |

**Mechanics that matter:** attack fast = bass gets out of the way the instant the kick transient hits; **release is where the groove lives** — tune it to the track so the bass swells back smoothly just before the next kick. Higher ratio / lower threshold = more obvious pumping.

**Ghost-kick / trigger tricks:** route a *muted* "ghost" kick (or any rhythmic dummy track) to the sidechain so you control ducking independently of the audible kick — useful when the real kick's shape clicks the comp badly, or to impose a different rhythm (e.g. a triplet dummy) on the bass. Nudging a duplicated kick slightly *earlier* and keying off it lets you use a slower, click-free open while staying tight (iZotope). Many producers also use volume-shaper / LFO tools to "draw" the duck curve instead of a compressor.

---

## Recommendations

**Stage 1 — Set up the session right (before any compression).**
- Insert a trim/gain utility first on every channel; bring averages to ≈ −18 dBFS, peaks ≈ −10 to −12 dBFS. Faders to unity. Mix-bus peaking ≈ −6 dBFS.
- Put a loudness/dynamics meter (LUFS + LRA, and a peak/RMS or crest readout) on the master. Do NOT mix into a limiter.

**Stage 2 — Compress to a stated purpose, one comp at a time.**
- Decide PUNCH, GLUE, or PEAK CONTROL before touching knobs. Use Table 1.
- Start attack slow on drums (10–30 ms) and only speed it up if a transient is genuinely too loud. Set release so the GR meter returns to zero just before the next hit.
- Keep track GR to 3–6 dB; bus GR to 1–3 dB. Gain-match makeup and A/B against bypass every time.

**Stage 3 — Gate/expand surgically.** Use Table 3. Prefer a gentle expander over a hard gate for bleed/noise; use a key filter for bleed you can't separate by threshold alone.

**Stage 4 — Add the EDM glue & pump.** Light bus glue (Table 2) with sidechain HPF. Sidechain bass/pads to the kick (Table 4); tune release to the tempo. Consider a ghost-kick trigger for control.

**Stage 5 — Diagnose before you finalize.** Read crest factor/PLR and LRA. Benchmarks that should change your actions:
- **Crest factor on the full mix < ~8 dB (or PLR < ~8–10 dB)** and you didn't intend extreme density → you're over-compressed; raise thresholds, lower ratios, or remove a comp. (iZotope flags 3–5 dB as the brick-walled extreme.)
- **PLR ≥ 10–14 dB** → healthy transient life; stop adding compression.
- **LRA collapsed toward ~0–3 LU** with no intended reason → restore section contrast (especially critical for trance/progressive).
- **Drums sound smaller after compression** → slow the attack; you're clamping the transient.
- **Bass muddy/distorted after compression** → release is too fast for the low frequencies; slow it (a 60 Hz note cycle is ~16 ms, so keep release above that) or HPF the sidechain.
- **You prefer the bypassed version at matched loudness** → use less, or go parallel, or remove the comp.

**Stage 6 — Respect the genre & the platform.** Techno/house: tighter, louder, constant kick is fine. Trance/progressive/melodic: protect breakdown→drop dynamics, lighter bus comp. Master toward your genre's competitive loudness but remember streaming normalizes (Spotify −14, Apple −16 LUFS) — earn density in the arrangement and mix; don't sacrifice dynamic range for loudness that the platform will just turn down. Keep true peak ≤ −1 dBTP.

## Caveats
- **Every number here is a STARTING POINT.** Source material, tempo, the specific compressor's topology (VCA/FET/opto/vari-mu), and the song override any table. Use your ears; gain-match first.
- **Standard vs rule-of-thumb, explicitly:** *Standards* = ITU-R BS.1770 loudness algorithm; EBU R128 (−23 LUFS broadcast target, −1 dBTP ceiling, LRA/Tech 3342); the −18 dBFS↔0 VU↔+4 dBu alignment; the streaming platforms' published normalization targets (Spotify −14, Apple −16 LUFS, etc.). *Conventions / rules-of-thumb* = all specific attack/release/ratio/threshold values, "1–3 dB GR on the bus," crest-factor "healthy ranges," genre dynamics expectations, and treating "−14 LUFS as a mastering target" (it's a normalization reference, not a mandate; most commercial EDM masters are louder).
- **Crest factor vs LRA vs dynamic range are not interchangeable** — the EBU explicitly warns against confusing them. Crest/PLR = micro-dynamics/transient health; LRA = macro/section dynamics. Bob Katz now favors loudness + PLR over his older K-System, and calls LRA "descriptive rather than prescriptive."
- **Forum and blog figures vary;** where pros disagree (e.g. some prefer fast attack on the SSL bus comp, others slow), the report gives the mainstream consensus and flags the spread. Treat single-source numeric claims as ballpark.
- **PLR uses LUFS, classic crest factor uses RMS** — they are closely related and often used interchangeably in practice, but not identical; flagged where it matters.