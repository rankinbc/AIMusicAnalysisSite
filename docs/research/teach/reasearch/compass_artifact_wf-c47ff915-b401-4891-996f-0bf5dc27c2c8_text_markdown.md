# EQ & Filtering Craft for EDM Mixing: A Parameter-Exact Reference

## TL;DR
- This reference gives concrete starting-point numbers (Hz / dB / Q / slope) for seven EQ fault categories and four cross-element techniques, separated for trance vs techno where conventions differ, with every recommendation flagged as FORMAL STANDARD, WIDELY-TAUGHT RULE-OF-THUMB, or INTERPOLATION/SYNTHESIS.
- The only truly fixed numbers are the formal standards: the ~20 Hz lower hearing limit (ISO 226:2003 / ANSI-ASA S1.1-2013), filter-slope definitions in dB/octave (6/12/18/24/48 per filter order), and loudness metering (ITU-R BS.1770 / EBU R128 at −23 LUFS, −1 dBTP; Bob Katz's K-System); everything else is a starting point to be tuned by ear in context.
- The single most important operating principle: EQ is corrective-in-context — solo only to find a problem, then judge and set the move with the full mix playing; small cuts across several tracks beat one large cut, and arrangement/sound-selection fixes often beat any EQ move.

## Key Findings
- **Mud lives 200–500 Hz**, with the densest pile-up at 200–300 Hz and "boxiness" at 300–500 Hz; the standard fix is the boost-and-sweep find then 2–4 dB cuts (rarely more than 6 dB) at moderate Q ~1–4.
- **Harshness (≈2–5 kHz) and sibilance (≈5–8 kHz) are different problems**: harshness is best treated with broad gentle cuts or dynamic EQ; sibilance with a de-esser, which also works on hats and bright synth leads, not just vocals.
- **"Air" above 10 kHz** is added with a gentle high shelf (typ. +1.5 to +4 dB from a 10–12 kHz corner); if the source genuinely lacks high-frequency content, boosting mostly raises hiss — use saturation/harmonic excitation instead.
- **Subsonic high-passing** is near-universal: 12 dB/oct is the workhorse slope; non-bass elements HP'd ~80–150 Hz, bass elements HP'd ~30–40 Hz with steeper 24–48 dB/oct slopes to protect headroom; techno runs a longer, lower sub than trance.
- **Surgical resonance removal** uses high Q (8–20+), found by the boost-and-sweep ("sweep and destroy") method; broad musical tone-shaping uses low Q (~0.5–1.5).
- **Complementary/masking-pair EQ** ("boost one, cut the other at the same frequency") is the canonical low-end fix for kick vs bass, typically −1.5 to −4 dB dips at Q 2–4.
- **The DJ filter** (single-knob LP↔HP morph, e.g. Pioneer DJM color FX / Xfer DJMFilter) is distinct from channel EQ and is the standard buildup/breakdown/transition tool; trance opens filters across long breakdowns, techno uses hypnotic filtered loops.

## Details

### Upfront note on epistemics and method
EQ is corrective-in-context. Every number below is a **starting point**, not a rule. The universal diagnostic move, repeated across virtually every credible source, is the **boost-and-sweep**: insert a parametric EQ, create a narrow bell with a large boost (+6 to +15 dB), sweep slowly until the offending frequency "jumps out like an airhorn in a library" (iZotope), then flip the boost to a cut and widen/narrow Q to taste. Always confirm the move in the full mix, not in solo (Mike Senior, *Mixing Secrets for the Small Studio*; Bobby Owsinski, *Mixing Engineer's Handbook* — "use a narrow bandwidth when cutting and a broader one when boosting").

Epistemic flags used:
- **[FORMAL STANDARD]** — AES/IEC/ISO/ITU/EBU specs and physically/mathematically defined quantities.
- **[RULE-OF-THUMB]** — engineer conventions repeated across credible named sources but not standardized.
- **[SYNTHESIS]** — reasonable inference where sources are silent, conflict, or only community/forum conventions exist.

---

### Formal foundations (apply throughout)

| Item | Value | Flag |
|---|---|---|
| Lower limit of human hearing | ~20 Hz (standardized equal-loudness contours stop at 20 Hz per ISO 226:2003; ANSI/ASA S1.1-2013 defines infrasound as below 20 Hz). Hearing does not abruptly stop — tones to ~12 Hz are perceptible at very high SPL; below 10 Hz single cycles are perceived. | [FORMAL STANDARD] |
| Filter slope per order | 1st order = 6 dB/oct (Q 0.5), 2nd = 12 dB/oct (Butterworth Q 0.707, −3 dB at corner), 3rd = 18, 4th = 24, 8th = 48 dB/oct. Slope = filter order × 6 dB/oct. | [FORMAL STANDARD] |
| Loudness measurement | ITU-R BS.1770 (K-weighting + gating). EBU R 128 (tech.ebu.ch) specifies integrated Programme Loudness Level of **−23.0 LUFS**, deviation **±0.5 LU** (±1 LU permitted for live/less-predictable material), **Maximum True Peak Level −1 dBTP**; first issued Aug 2010, latest revision v5.0 Nov 2023, developed by the EBU PLOUD group chaired by Florian Camerer (ORF). | [FORMAL STANDARD] |
| Streaming loudness references | Spotify normalizes to **−14 dB LUFS** per ITU-R BS.1770 (user-selectable: "Quiet" −19, "Normal" −14, "Loud" −11 LUFS; "Loud" applies a limiter engaging at −1 dB, 5 ms attack, 100 ms decay). Apple Music ≈ −16 LUFS; Deezer ≈ −15 LUFS. YouTube and Tidal use **downward normalization only** (turn loud content down, do not turn quiet content up). | [FORMAL STANDARD (platform-published)] |
| K-System (Bob Katz) | K-20/K-14/K-12 = headroom above a 0 dB anchor calibrated to 83 dB SPL (C-weighted, slow) per channel; Katz recommends mixing to K-20, mastering to K-14. | [FORMAL STANDARD (defined system)] |
| DC offset | Shifts waveform off zero, steals headroom and can cause clicks; a steep HPF at ~20 Hz removes it (12 dB/oct leaves a 0.5 Hz signal >60 dB down). | [FORMAL STANDARD (rationale); RULE-OF-THUMB (20 Hz choice)] |
| Shelf "corner frequency" caveat | There is no single industry definition of a shelf's stated frequency (could be the −3 dB point, the half-gain point, or the point of full gain); manufacturers differ. Treat stated shelf Hz as approximate. | [FORMAL STANDARD (ambiguity is real)] |

---

### 1. Low-mid mud & boxiness (200–500 Hz)

**What accumulates mud:** pads, layered synths, bass harmonics/overtones, kick body, rhythm/lead synths, reverb tails. "A muddy mix is often just a traffic jam in the low-mid frequency range" (cryo-mix). Sage Audio places the busiest zone at 150–450 Hz; Adrian Milea splits it as 200–300 Hz (body/mud), 300–500 Hz (boxiness), 500–800 Hz (honk).

**Starting points:**
- Find it: boost-and-sweep with a narrow +6 to +10 dB bell from ~100–500 Hz; the most unpleasant/boxy frequency is the target.
- Cut depth: **−2 to −4 dB** per offending track, **moderate Q ~1–4** (bell). Keep total low-mid cuts on any single track under ~6 dB.
- Bass-specific mud: target 200–250 Hz first with a **−3 to −6 dB** medium-wide bell; if it persists, sweep 300–350 Hz (cryo-mix).
- Spread small cuts across several tracks rather than one big cut (Adrian Milea; Sage Audio).
- Dynamic EQ option: use a dynamic bell (e.g., FabFilter Pro-Q, sidechained kick→bass) so the cut only engages when density occurs (Sage Audio).

**Trance vs techno deltas:**
- **Trance:** the mid-bass character layer lives 100–400 Hz; keep it tidy by HP ~80–100 Hz and LP ~400–600 Hz so it doesn't muddy the pluck/lead (Steve Allen).
- **Techno:** 250–500 Hz flagged as the "dangerous" zone for kick body buildup; carve here aggressively because techno arrangements are sparser and the low end carries the track.

**Sources:** Sage Audio, Adrian Milea, cryo-mix, iZotope, Abletunes EQ cheat sheet; Steve Allen (trance). **Flag:** [RULE-OF-THUMB] (frequencies/depths); the sweep method itself is universal [RULE-OF-THUMB].

---

### 2. Harshness (2–5 kHz) vs sibilance (5–8 kHz)

**Distinction:** Harshness/ear-fatigue/"edge" sits roughly 2–5 kHz (the ear's most sensitive band, ~2.5–4.5 kHz); sibilance ("ess/ch/ts") sits ~5–8 kHz, occasionally up to 10 kHz (per voice). Owsinski's octave map: 2 kHz = "crunch," 4 kHz = "edge," 8 kHz = "sibilance/definition/ouch."

**Starting points:**
- Harshness: broad-to-moderate-Q **−1 to −3 dB** cut in the 3–5 kHz region (MasteringBOX: "a narrow or moderate-Q cut (1–3 dB)"). If harshness is dynamic (only on peaks), use **dynamic EQ** so brightness is preserved during softer moments.
- Sibilance/de-essing on vocals: de-esser centered where esses are harshest — male voices often ~5–6 kHz, female ~7–8 kHz; range commonly 4–8 kHz. Aim for just enough gain reduction to round the S without lisping.
- De-essing on hats/cymbals: split-band de-esser targeting ~7–10 kHz (e.g., threshold −12 dB, range −4 dB as a starting point) to tame spikes while preserving shimmer (Unison; Icon Collective).
- De-essing on harsh/bright synth leads & "dubstep" basses: wide- or split-band de-esser, mild settings (e.g., threshold −10 dB, ~3 dB reduction) to smooth the top (Unison; Icon Collective).
- Static vs dynamic: static cuts for consistently harsh sources; dynamic EQ / de-essing for intermittent harshness. Dynamic EQ "acts like a regular EQ, but only when the signal at a specific frequency crosses a threshold" (FabFilter / Nail The Mix).

**Trance vs techno deltas:**
- **Trance** is vocal- and supersaw-lead heavy: expect both 2–5 kHz supersaw harshness and 5–8 kHz vocal sibilance; tame supersaws with a gentle 3–4 kHz cut and de-ess vocals separately.
- **Techno** is usually instrumental: harshness shows up in hats, ride loops, metallic percussion and distorted/saturated stabs around 3–8 kHz — a split-band de-esser on the hat/perc bus is the typical tool.

**Sources:** iZotope vocal cheat sheet, Unison, Splice, Produce Like A Pro, Icon Collective, MasteringBOX, Owsinski. **Flag:** [RULE-OF-THUMB].

---

### 3. Dull or absent "air" (above 10 kHz)

**Starting points:**
- Gentle high shelf, corner **10–12 kHz**, **+1.5 to +4 dB** for a polished top (MasteringBOX: "a gentle high-shelf boost around 10 kHz or higher"; eMastered notes a slight 10 kHz boost on pop vocals). The "Pultec trick" 6–8 dB boost at 10/12 kHz exists but is widely considered excessive for most material and is more a coloristic move than a corrective one.
- Resonant peak vs gentle shelf: use a **gentle low-Q shelf** for broad sheen/vibe; use a **higher-Q peak boost** only to emphasize a specific sparkle frequency (e.g., a cymbal's "tsss"). Boosting with a narrow Q makes a frequency stick out (Owsinski).
- Air genuinely missing vs adding hiss: if the source has little real HF content, a shelf "just makes a muddy mix that's also harsh" / mostly lifts hiss and noise (Abletunes warns boosting 8–12 kHz "may add hiss"). In that case prefer **harmonic excitation/saturation** to generate new high harmonics, or specialist "air" EQs (Maag EQ4, Kush Clariphonic, Eiosis AirEQ — Sonarworks).
- De-ess after an air boost on vocals to keep added brightness from exaggerating esses (eMastered: "boost the top end with an EQ (6–12 kHz) and tame it with a de-esser").

**Trance vs techno deltas:**
- **Trance:** breakdowns and supersaw leads benefit from generous air (high shelf +2 to +4 dB at 10–12 kHz) to feel "huge" and emotional.
- **Techno:** air is applied more sparingly — often just enough on the hat/ride bus and the overall master to keep the track from sounding dull on club systems; over-bright techno fatigues on big PAs.

**Sources:** MasteringBOX, eMastered, Sonarworks, Abletunes, KVR forum (Pultec trick), Owsinski. **Flag:** [RULE-OF-THUMB]; "boosting adds hiss when content is absent" is [FORMAL STANDARD] in principle (you cannot boost what is not there).

---

### 4. Thin vs boomy low end

**Where things live (Owsinski octave map + EDM sources):** 63 Hz = bottom; 125 Hz = boom/thump/warmth; 250 Hz = fullness/mud. EDM specifics: weight/sub 40–60 Hz; audible "body"/punch 60–120 Hz; boom 60–120 Hz when excessive; 200–250 Hz "honk"/boxiness.

**Starting points:**
- Thin low end: add weight with a **wide-Q +2 to +3 dB** boost around **70–100 Hz** (Abletunes: "boost 2–3 dB with wide Q within 70–100 Hz… don't overdo it"); meters rise fast here, so re-gain.
- Boomy low end: cut **−2 to −4 dB** around 60–120 Hz (boom) and/or 200–250 Hz (honk/boxiness). A low shelf cut can tilt down an over-full bottom.
- Low-shelf shaping: a gentle low shelf (e.g., −2 to −3 dB from ~120–150 Hz) tames general boom; a low-shelf boost adds warmth but risks mud.
- Kick/bass relationship: pick which element owns the sub. Kick fundamental typically 40–80 Hz; bass fundamentals 40–400 Hz. Use complementary EQ (Section 8) and/or sidechain.

**Trance vs techno deltas:**
- **Trance:** three-part low end — kick (transient, 50–100 Hz fundamental + click), sub (sine, ~40–80 Hz), mid-bass (character, 100–400 Hz). "Weight" is shared kick+sub; "boom" usually creeps in from sub/kick overlap at 55–110 Hz (Steve Allen).
- **Techno:** often a long, sustained sub or sub-heavy kick carries 40–120 Hz; "boom" comes from too-long kick tails (150–300 ms in minimal techno) overlapping the bass. Balance "sub power with mid-bass clarity… focused impact around 50 Hz, push bass harmonics above 90 Hz" (Samplesound).

**Sources:** Owsinski, Abletunes, Steve Allen, Samplesound, Sonarworks. **Flag:** [RULE-OF-THUMB].

---

### 5. Subsonic rumble (below 30 Hz) & high-pass strategy

**Rationale (formal):** Frequencies below ~20 Hz are inaudible/felt-only, waste headroom, push compressors/limiters into odd behavior, and carry DC offset. A steep HPF near 20 Hz removes both subsonic rumble and DC offset and recovers headroom — re-normalizing after a 20 Hz low cut yields a "much hotter" level (Craig Anderton, *DC Offset: The Case of the Missing Headroom*).

**Starting points:**

| Element | HP corner | Slope | Flag |
|---|---|---|---|
| Master / mix bus (subsonic + DC clean-up) | 20–30 Hz | 12–18 dB/oct (gentle, mastering) | [RULE-OF-THUMB] |
| Kick (sub-bearing) | 20–40 Hz | 24–48 dB/oct to protect headroom | [RULE-OF-THUMB] |
| Bass / sub (non-sub-bearing of the pair) | 30–50 Hz | 12–24 dB/oct | [RULE-OF-THUMB] |
| Vocals | 80–120 Hz | 12–24 dB/oct | [RULE-OF-THUMB] |
| Pads | 100–200 Hz | 12 dB/oct | [RULE-OF-THUMB] |
| Guitars/keys | 100–150 Hz | 12 dB/oct | [RULE-OF-THUMB] |
| Hats/cymbals | 200–400 Hz | 12–24 dB/oct | [RULE-OF-THUMB] |

- The **12 dB/oct (2nd-order Butterworth)** slope is the most-cited workhorse — "steep enough to remove what you don't need, gentle enough to keep the source sounding real" (electronicproduction.co.uk). Steeper (24/48) is reserved for aggressive subsonic protection on bass elements, at the cost of phase shift/transient smearing near the corner.
- Don't set-and-forget: sweep the HP cutoff up while the full mix plays until the sound thins, then back off slightly (multiple sources).

**Trance vs techno deltas:**
- **Trance:** HP the sub "below about 35 Hz (nothing useful lives there for trance)" and LP it ~100–120 Hz; HP all non-bass elements 80–120 Hz, 12 dB/oct (Steve Allen; ReadyforMasterclass).
- **Techno:** runs a longer/lower sustained sub; commonly HP the bass channel only at ~30 Hz to keep maximum low-end weight, and let the kick or sub extend 40–120 Hz. Keep everything below ~120–150 Hz mono.
- iZotope (named EDM producer interview): "it's common to cut everything from 120 Hz on down except for your kick drum and your bass," and roll a top-bass "below 90 Hz with a slope of 24 dB" — applies to both genres.

**Sources:** Craig Anderton, asmr.education, electronicproduction.co.uk, iZotope, Steve Allen, ReadyforMasterclass, Samplesound. **Flag:** rationale [FORMAL STANDARD]; specific corners/slopes [RULE-OF-THUMB].

---

### 6. Resonant ringing / resonance removal

**Causes:** synth-resonance (self-resonant filters, over-driven patches), sample-resonance (cheap recordings, old breaks, room ring baked into samples), and room modes (your monitoring environment, not the file).

**Starting points:**
- Find it ("sweep and destroy"): narrow bell, **+12 to +15 dB boost**, **high Q**, sweep slowly, solo the band if needed; the resonance "jumps out" (iZotope; Mastering The Mix; fanumusic).
- Cut: **Q ~8–20+** (very narrow / notch), depth typically **−3 dB up to deep notch** depending on severity — only cut as much as removes the problem without killing life. "Widen or narrow the Q until you're only removing the problem without killing the good stuff around it" (iZotope).
- Low-end resonance clashes: sweep with Q ~3–5, find the ringing note, notch it on the less-important element (Unison).
- Dynamic option: dynamic EQ or a dedicated resonance suppressor (Soothe2, Mastering The Mix RESO) when the resonance is intermittent or pitch-shifting.
- "Stress-test" trick: insert a heavy limiter (15–20 dB GR) before a sweeping EQ band to expose hidden resonant peaks, then tame and remove the limiter (iZotope).
- Room modes vs source: if moving your head ±6 inches changes the low-mid balance dramatically, the resonance is your room, not the track — fix monitoring/position before EQ'ing (Adrian Milea).

**Trance vs techno deltas:** Largely genre-neutral. Techno's reliance on raw/hardware and sampled loops makes sample-resonance and metallic synth-resonance more common; trance's supersaw stacks can build broad resonant peaks in the 1–4 kHz region across layers.

**Sources:** iZotope, Mastering The Mix, fanumusic, Unison, Baby Audio, Adrian Milea. **Flag:** [RULE-OF-THUMB]; Q-as-bandwidth is [FORMAL STANDARD].

---

### 7. Overall tonal tilt — too dark vs too bright

**Starting points:**
- Tilt EQ: a single control that boosts highs while cutting lows by the same amount around a pivot (HoRNet Angle). Typical corrective tilt across the spectrum is modest — on the order of **±1 to ±3 dB** end-to-end for a balance nudge; mastering-stage moves are smaller still (0.25–0.5 dB can "make or break a master," Sonarworks).
- Reference-track matching: compare your spectrum to commercial references at matched loudness. Tools: iZotope Tonal Balance Control (curves from thousands of pro tracks; Orchestral/Bass-Heavy/Modern + custom), FabFilter Pro-Q EQ Match, Mastering The Mix EXPOSE/REFERENCE, ADPTR Metric AB. EXPOSE example: "0–500 Hz around −5 dB… less low-end than your reference."
- Bright → darker: BAX-style high-shelf cut (and/or low-shelf boost) to gently tilt down; or a smooth low-pass with a very shallow slope (0.3–0.9 dB/oct, FabFilter Pro-Q 4 continuous slope) above ~33 Hz to act like a tilt without lifting the sub.
- Dark → brighter: gentle high shelf above 8–10 kHz; beware 1 kHz over-energy, which reads as bright/harsh and "louder" but unnatural (Polarity).
- A pre-limiter tilt that darkens the input by ~6 dB at 10 kHz, restored by the chain, can prevent the limiter from eating transients and adding HF distortion (thesimpletom).

**Trance vs techno deltas:**
- **Trance** trends brighter and more "hyped" (airy leads, bright vocals) — references should be other trance masters or it will read as dull by comparison.
- **Techno** trends darker, mid-forward and rawer; matching to a pop/EDM "Modern" curve will make it too bright. Reference within-genre.

**Sources:** HoRNet, iZotope, Mastering The Mix, Sonarworks, Polarity, thesimpletom (FabFilter). **Flag:** [RULE-OF-THUMB]; tilt-EQ behavior [FORMAL STANDARD].

---

### 8. Cross-element technique — Complementary / masking-pair EQ

**Concept (formal):** Frequency masking = when two sounds share a frequency range at similar levels, the louder masks the quieter (psychoacoustic). The fix: carve a dip in one element exactly where the other's key energy sits — the **"boost one, cut the other at the same frequency"** mirror move.

**Starting points:**
- Kick vs bass (canonical): if the kick's fundamental is ~60 Hz, boost kick there and cut bass −X dB at 60 Hz; conversely boost bass ~80–100 Hz and dip the kick there. Typical dips **−1.5 to −4 dB**, **Q ~2–4** (Sonarworks; MixingMonster; Samplesound).
- Mirror technique detail: don't over-boost — "instead of boosting 5 dB… apply a slight 2 or 3 dB cut at the same spot" on the partner (LedgerNote).
- Vocal vs lead synth (mids): notch the synth −2 to −3 dB with a narrow Q where the vocal's presence sits (2–3 kHz), optionally boosting the vocal subtly there (The Producer School).
- Pad vs vocal: HP the pad above the vocal's low fundamentals and dip the pad in the vocal's core range; on supporting parts you can HP right above the fundamental so only overtones remain (Sage Audio).
- Tools that visualize collisions: FabFilter Pro-Q (collision detection), iZotope Neutron Unmask, Blue Cat FreqAnalyst side-by-side.
- Dynamic version: sidechain a dynamic EQ on the bass to the kick so the cut only happens when the kick hits — "static EQ for kick and bass is becoming an outdated approach" (eMastered).

**Trance vs techno deltas:**
- **Trance:** with bass root e.g. A (55 Hz, harmonics 110/220), put −1.5 to −2 dB dips on the kick at 55 Hz and 110 Hz to make a window for the sub (Steve Allen).
- **Techno:** narrow bell **Q 2–4, −2 to −4 dB** cuts; decide early whether kick or bassline carries the sub, and carve the other out of that zone (Samplesound).

**Sources:** Sonarworks, iZotope, MixingMonster, LedgerNote, The Producer School, Sage Audio, eMastered, Steve Allen, Samplesound. **Flag:** masking concept [FORMAL STANDARD]; depths/Q [RULE-OF-THUMB].

---

### 9. Cross-element technique — High-passing non-bass elements

**Convention:** HP nearly everything that isn't kick/bass to clear low-end headroom. "If you're not already, you should be using the traditional high pass filter on almost every channel (with the exception of the kick, bass… and synth)" (Mixcademy, channeling the small-studio convention). Mike Senior (*Mixing Secrets*) and Owsinski both treat aggressive low-end cleanup on non-bass tracks as routine.

**Typical corners per element** (consolidated; see Section 5 table): vocals 80–120 Hz; pads 100–200 Hz; guitars/keys 100–150 Hz; hats/cymbals 200–400 Hz; FX/atmospheres up to 300–500 Hz; sampled one-shots up to 1–2 kHz where the useful fundamentals live (Produce Like A Pro).

**Two-stage HP technique (Mike Senior-style):** combine a true HP roll-off with a second broad parametric cut of −3 to −10 dB around 100–300 Hz — a full roll-off below plus a partial reduction of the frequencies you want less of (Mixcademy).

**Cautions / over-high-passing debate:**
- Over-HP'ing thins sounds and removes body that glues a mix; "don't overdo, as you may thin out the sound" (Abletunes).
- Steep HPFs introduce phase shift and can smear/soften transients near the corner; gentle slopes are more transparent.
- A resonant HPF adds a boost at the corner ("a bit of roundness") which can be used creatively (iZotope).
- HP in context and sweep — a part that sounds thin soloed may sit perfectly in the mix (Adrian Milea; Owsinski).

**Trance vs techno deltas:**
- **Trance:** HP all non-bass elements 80–120 Hz, 12 dB/oct (Steve Allen; ReadyforMasterclass: "Set it between 80–120 Hz… 12 dB/oct so it sounds natural").
- **Techno:** similar, but because arrangements are sparser, some producers HP less aggressively to preserve a raw, full character — while still keeping <120–150 Hz mono.

**Sources:** Mixcademy, Mike Senior, Owsinski, Produce Like A Pro, Abletunes, iZotope, Adrian Milea, Steve Allen. **Flag:** [RULE-OF-THUMB].

---

### 10. Cross-element technique — Surgical narrow-Q vs broad low-Q shaping

**Two regimes:**

| Goal | Q range | Typical depth | When |
|---|---|---|---|
| Surgical (problems) | **Q ~4–20+** (notch up to 100+) | −3 dB to deep notch | Resonances, ringing, feedback, mud notches, hum, room-mode ring, sibilant spikes |
| Broad musical (tone/vibe) | **Q ~0.5–1.5** | ±1 to ±4 dB | Tonal balance, warmth, air, "vibe," tilt, shelf moves |

- Cut narrow, boost wide: "use a narrow bandwidth (Q) when cutting and a broader one when boosting" — narrow boosts make a frequency stick out unpleasantly (Owsinski; Produce Like A Pro).
- Boost a little of two nearby frequencies rather than a lot of one (Owsinski).
- Mastering = broad/gentle only (low-Q, fractions of a dB); narrow surgical moves at the master stage risk phase artifacts and are reserved for taming a specific resonance (Sonarworks; MasteringBOX).

**Trance vs techno deltas:** Genre-neutral principle. Techno's saturated/raw sources may need more surgical notching of metallic resonances; trance's broad shelves and tilts shape the lush, bright signature.

**Sources:** Owsinski, Produce Like A Pro, Sonarworks, MasteringBOX, FabFilter. **Flag:** Q-as-bandwidth [FORMAL STANDARD]; regime guidance [RULE-OF-THUMB].

---

### 11. DJ-filter / sweep-filter usage (tonal & transition tool)

**Definition — DJ filter ≠ channel EQ.** A "DJ filter" is a **single-knob LP↔HP morph** with a neutral center detent: turn left for progressive low-pass, right for progressive high-pass, with a **musical resonance** ("swoop") at the cutoff (Digital DJ Tips). Hardware: Pioneer DJM "Sound Color FX" Filter; software: Xfer DJMFilter (a state-variable filter that "allows for LP/HP in one control," emulating the DJM-800/900). This is distinct from the 3-band channel EQ on a DJ mixer, and distinct from a parametric/bell EQ.

**Resonance/emphasis settings:** DJM color-knob filters can sound "squelchy" with high built-in resonance; software filters expose a separate resonance/Q knob. For sweeps, start resonance/Q low for a smooth sweep (Q ~0.7) and raise it (resonance ~1.0 → 2.5) for added energy/edge; very high resonance approaches self-oscillation and can get harsh.

**Typical cutoff sweep ranges & automation:**
- Buildup (low-pass opening up): automate LP cutoff rising; example "low-pass… starting at 200 Hz… upward to 8 kHz over 8–12 bars" (Unison); or an arp "from 400 Hz to 8 kHz" on the master (Myloops). EQ-automation variant: "+6 dB band starting at 200 Hz, sweeps up to 2 kHz over four beats" (Erik Veach / Soundfly).
- Breakdown → drop: high-pass everything, then sweep the cutoff to reintroduce lows; or LP the whole mix and open it into the drop. Master-channel filter automated "straight before the drop" (Attack Magazine).
- Clean re-entry: HP "starting at 100 Hz and sweeping down to 20 Hz" (Unison).
- Slope: 12 dB/oct = natural/organic; 24 dB/oct (+ resonance ~2.5) = dramatic risers (Unison).
- Build length: match the section — a 4-bar build can feel abrupt in a 7-minute trance track; 8 bars is "fail safe" (EDMProd).
- Named pro use: on Lady Gaga's "Rain On Me" (123 BPM, C♯ minor), engineer Benjamin Rice told Sound on Sound (*Inside Track*, Aug 2020): "For the synths, I didn't need to do much. I used the DJM filter during the pre-chorus to filter everything into the chorus." — the canonical "filter into the drop" move at pop/house level.

**Trance vs techno deltas:**
- **Trance:** long breakdowns are the signature filter-sweep window — the filter slowly **opens** across 8–16 bars (often the whole arrangement) to refill the spectrum into the drop, frequently layered with reverb and white-noise risers (We Are Crossfader; MTO/Smith on EDM buildups). Breakdown filter-opening is "the most musical transition technique" in trance/progressive/melodic-house (Mixgraph).
- **Techno:** filters are used **hypnotically and continuously** on looped elements rather than as one big breakdown reveal — e.g., automate a synth-loop cutoff "start from 50 Hz and increase slowly to reach a high value at the end of every four bars" (Attack Magazine, *Theory of Techno Pads*), or LFO-to-cutoff at slow rates (0.1–1 Hz, ~20% depth) for an evolving filtered loop (Mind-Flux). HP filters on drum loops in breakdowns are "highly effective" for tension (Attack Magazine).

**Sources:** Digital DJ Tips, Learning to DJ, Equipboard, Splice/Reverb (DJMFilter), Pioneer DJ forum, Sound on Sound (named engineer Benjamin Rice), Unison, Myloops, Soundfly, EDMProd, Attack Magazine, Mind-Flux, We Are Crossfader, Mixgraph, MTO/Smith. **Flag:** definition/mechanism [FORMAL STANDARD/clear]; sweep ranges & genre usage [RULE-OF-THUMB]; some forum specifics [SYNTHESIS].

## Recommendations

**Stage 1 — Clean up (do first, every project):**
1. HP non-bass elements per the Section 5 table (start vocals 80–120 Hz, pads 100–200 Hz, hats 200–400 Hz; 12 dB/oct), sweeping each up until it thins then backing off.
2. HP the master/mix bus ~20–30 Hz (subsonic + DC). Confirm low-end is mono below ~120 Hz (trance) / ~120–150 Hz (techno).
3. Decide which of kick/bass owns the sub before EQ'ing.

**Stage 2 — Carve and correct:**
4. Boost-and-sweep each muddy track in 200–500 Hz; apply −2 to −4 dB cuts at Q ~1–4; keep total under ~6 dB per track.
5. Apply complementary kick/bass dips (−1.5 to −4 dB, Q 2–4) at each other's fundamentals; add sidechain or dynamic EQ if they still clash.
6. Remove resonances with the sweep-and-destroy method (Q 8–20+, cut only as deep as needed).
7. Treat harshness (3–5 kHz, gentle/dynamic cut) and sibilance (de-esser at 5–8 kHz; on hats/leads too) separately.

**Stage 3 — Polish and balance:**
8. Add air with a gentle 10–12 kHz shelf (+1.5 to +4 dB) only if real HF content exists; otherwise use saturation.
9. Check tonal tilt against an in-genre reference at matched loudness (Tonal Balance Control / EQ Match / EXPOSE); correct with ±1–3 dB broad/tilt moves.
10. Meter to ITU-R BS.1770/LUFS; keep true peak ≤ −1 dBTP. For streaming, target ~−14 LUFS integrated as a reference point (Spotify "Normal") — but prioritize a balanced, dynamic master over chasing a number, since loudness normalization will turn an over-cooked master down anyway.

**Stage 4 — Performance/transition layer (DJ filter):**
11. Use the single-knob DJ filter (not channel EQ) for buildups/breakdowns; LP-open sweeps over 8–16 bars into trance drops; hypnotic continuous cutoff/LFO automation for techno loops.

**Thresholds that change the advice:**
- If cuts exceed ~6 dB on one track or you're cutting the same band on many tracks, the problem is **arrangement/sound-selection** — fix that first.
- If head movement changes the low-mid balance, the problem is the **room/monitoring** — treat/relocate before EQ'ing.
- If an air boost only raises hiss, the HF content is **absent** — switch to saturation.
- If a static kick/bass cut leaves the bass thin when the kick is absent, switch to **dynamic EQ/sidechain**.

## Caveats
- **Numbers are starting points, not rules.** Every frequency, dB, and Q above must be tuned by ear in the full-mix context; "no two mixes or mix elements are alike" (Owsinski).
- **Source-quality grading:** Highest-authority sources here are the formal standards (ITU/EBU/ISO/ANSI), plugin-maker documentation (FabFilter, iZotope), established names (Bob Katz, Mike Senior, Bobby Owsinski) and magazines (Sound on Sound, Attack Magazine). Genre-specialist blogs (Steve Allen/tranceproducer.co.uk, Samplesound, WEAPON) are reliable but commercial (they sell courses/sample packs). Education sites (Unison, Myloops, eMastered, MasteringBOX) are rule-of-thumb tier. Forum/community posts (Gearspace, KVR, Quora, VirtualDJ) are corroboration only and flagged as such.
- **Trance-vs-techno sub-length contrast is a cross-source synthesis,** not a single sourced claim: techno's longer/lower sustained sub is inferred from kick-tail figures (150–300 ms minimal techno) and 40–120 Hz sustained sub vs trance's tighter HP-35/LP-120 sub plus a separate mid-bass character layer. Treat as [SYNTHESIS].
- **Shelf and "corner frequency" labels are not standardized** across manufacturers — a stated "10 kHz shelf" may measure differently between plugins.
- **K-System status:** Katz himself considers the original K-System partly superseded by LUFS/PLR-based monitor calibration in the latest edition of his book; it remains a valid, widely-taught framework.
- **The loudness-war context:** loudness-normalized streaming means an over-hyped or over-bright master gets turned down and can sound worse than a balanced one; mix for balance and translation, not raw level.
- **Monitoring dependency:** none of these low-end moves are reliable without adequate monitoring (treated room or full-range headphones); low-frequency perception is dominated by room acoustics.