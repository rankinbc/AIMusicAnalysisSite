# The EDM Producer's Reference Guide to Harmonic Saturation and Intentional Distortion

## TL;DR
- **Saturation adds harmonics and gentle compression simultaneously** — even-order harmonics (octaves) sound "warm and musical," odd-order harmonics sound "edgy and aggressive." Match the type to the goal: tube/triode for warmth, transistor/pentode and clipping for aggression, tape for glue, bitcrushing for lo-fi grit.
- **Always level-match and blend.** Saturation tricks your brain into "louder = better." Use the output/auto-gain knob so you judge tone (not volume), and use parallel (dry/wet) blending to keep transients intact. Start subtle: ~1–2 dB drive / ~2–5% mix on a master bus, ~20–40% mix in parallel on individual elements.
- **Saturation is the wrong tool for fixing existing harshness or unwanted distortion** — that is an EQ or source-replacement job. Stacking more saturation only multiplies harmonics around the problem frequency. EQ first, then saturate.

## Key Findings
1. The character of saturation comes from its **transfer curve** (how output deviates from input) and the **harmonic series** it generates. The harder you drive, the more harmonics *and* the more compression.
2. **Even vs odd harmonics** is the single most useful mental model — but drive level matters more than character choice for most amateur decisions.
3. Harmonics increase **perceived loudness and density** differently from limiting: they fill spectral gaps and add RMS energy, and they make bass audible on small speakers via the "missing fundamental" effect.
4. **Parallel processing** is the safest way to use aggressive saturation because the dry path preserves transients and sub-bass.
5. **Oversampling matters** specifically for saturation/clipping because nonlinear processing creates harmonics above Nyquist that fold back as inharmonic aliasing.
6. **Exciters generate** new high-frequency harmonics; EQ can only boost what already exists — a crucial distinction for dull/dark sounds.

## Details

### 1. Saturation Types and Their Sonic Character

**The transfer-curve concept.** Every saturator works by reshaping the input waveform according to a transfer function — a curve mapping input level to output level. A perfectly straight (linear) line means no coloration. As the line bends (becomes nonlinear), the peaks get "rounded off," and that rounding generates harmonics. A **gentle bend = soft clipping** (a few low-order harmonics that decay quickly); a **sharp corner = hard clipping** (dense harmonics across a wide range). As KERN Audio's guide puts it, "soft clipping produces fewer harmonics that decay faster; hard clipping generates dense harmonics across a wider range." A clipper has a flat ceiling (samples above the threshold are truncated to the ceiling value); a saturator uses a curve approaching the ceiling so harmonics build progressively as the signal gets louder.

**Even-order vs odd-order harmonics.** Harmonics occur at integer multiples of the fundamental. For a 100 Hz tone: even harmonics appear at 200, 400, 600 Hz (octave and octave-plus-fifth relationships); odd harmonics at 300, 500, 700 Hz (a more dissonant, "hollow" series resembling a dominant-7 chord). The widely-agreed CONVENTION — traceable to the Davis/Jones *Sound Reinforcement Handbook* — is that "odd-order harmonics (3rd, 5th, 7th) are more harsh, and even-order harmonics (2nd, 4th, 6th) are more musical to the average listener." Even harmonics are "always in key" because a 2nd harmonic is an exact octave. **Caveat (matter of nuance):** seasoned engineers on Gearspace note the oddness/evenness is "mostly trivia" — transformer distortion, tape, and limiters all produce mostly odd harmonics yet sound nothing alike. What the harmonics are doing (low vs high order; only on transients vs steady-state; plus the pre/post EQ) matters as much as their parity.

**Tube/valve saturation.** Tubes distort *asymmetrically* relative to their operating point, which promotes **even-order harmonics** (especially the 2nd). This is the classic "warm, thick, musical" sound that adds body without aggression. Bob Katz is unequivocal on its appeal: "I believe that second harmonic distortion is sonic gold for audiophiles: It's very seductive, especially if you want a warm sound quality, three-dimensionality, and beautiful reproduction of ambience and depth" (Stereophile, "Katz's Corner Episode 25: Adventures in Distortion," May 2018). A triode (e.g., Decapitator's "T" style) adds even harmonics and a punchy, warm character; a pentode ("P" style) is wired differently and produces odd harmonics with a harder edge. Best for: warming pads, adding body to bass, gentle vocal warmth.

**Tape saturation.** Tape combines **mild distortion with natural compression** ("tape compression"), smoothing/soaking up transients while adding both even and odd harmonics (with an emphasis often described as odd/3rd-order). Its full character includes: a **head bump** (a low-end resonance boost around 80–160 Hz depending on tape speed), **frequency-dependent compression** (highs are pre-emphasized so they saturate first, gluing the top end while bass stays relatively clean), **wow and flutter** (subtle pitch instability — wow affects lows, flutter roughens highs), and a **gentle high-frequency rolloff** from the head gap. Slower tape speeds (e.g., 7.5 IPS) = more low-end bump and a darker tone; faster (15–30 IPS) = cleaner and more defined. Best for: drum-bus glue, mix-bus cohesion, taming digital brightness.

**Transistor/solid-state saturation.** Transistors distort *symmetrically*, which preserves half-wave symmetry and promotes **odd-order harmonics**. The result is "tighter, punchier, more aggressive" with a harder edge — excellent for grit on bass, leads, and snares. Neve-style germanium-transistor circuits (Decapitator's "N" style) have their own characterful, slightly dull-but-full coloration.

**Tanh / waveshaper / mathematical saturation.** The hyperbolic tangent (tanh) function maps any input to the range (−1, +1): small inputs pass nearly linearly, large inputs compress toward the limits. This is mathematically "soft clipping" with a smooth transition. Because tanh clips both halves of the waveform identically (symmetric), it produces **odd harmonics** — a clean, predictable, "classic tube-amp-style" warmth that's smooth and forgiving. Waveshapers can use arbitrary transfer curves: a sine-based shaper folds the signal to create metallic, bell-like FM-style overtones; polynomial (Chebyshev) shaping produces a fixed, controllable, finite set of harmonics.

**Diode/clipper distortion.** Hard clippers mathematically truncate peaks at a ceiling, generating dense odd harmonics — harsh on their own, but on kicks and snares a touch adds incredible punch and loudness while controlling peaks. Soft clippers (diode-style curves) give a more gradual transition. The practical EDM distinction: clippers are used to control peaks and add loudness/aggression; saturators are used to add character and density. Clipping is often preferred over aggressive limiting in modern EDM because it creates controlled distortion rather than the "pumping" of a limiter.

### 2. Saturation for Perceived Loudness and Density (Without Raising Peak Level)

Saturation increases loudness through a fundamentally different mechanism than limiting. **Limiting** reduces peaks so you can raise the overall level. **Saturation** adds harmonic content that *fills out the sound* — increasing RMS/average energy and spectral density — while its soft-clipping action actually *lowers* peak values. As Produce Like A Pro describes the Softube Saturation Knob, "when you check peak values, they can be quieter than they were without saturation engaged. The plugin is squashing the peaks while adding richness and body to the rest of the signal."

The **psychoacoustics:** human hearing is most sensitive in the 2–5 kHz range (the Fletcher-Munson / ISO 226 equal-loudness contours; this is the speech-intelligibility band). Harmonics that land here are perceived as louder than equal-amplitude harmonics elsewhere, so adding upper harmonics makes a sound seem louder and more present without changing its fundamental level. The **"missing fundamental"** effect is the key bass technique: even if a small speaker can't reproduce a 40 Hz sub, the brain reconstructs the perceived pitch from the harmonics (80, 120, 160 Hz...), so saturating an 808/sub adds harmonics that let it be "heard" on phones and laptops.

Bob Katz documents the loudness link directly: discussing a heavily limited master, he notes it "will probably still sound extra loud because of the distortion" (TapeOp interview). **Important technical clarification (flag for users):** because LUFS is an RMS-based, K-weighted measure, harmonics added by saturation DO register on a LUFS meter (they add real energy) — so saturation raises *measured* loudness, not merely "perceived" loudness. This complements limiting: saturate first to add density and tame peaks gently, then limit for the final loudness ceiling.

A commonly repeated figure is that saturation can add "1–2 dB" of perceived loudness at a given LUFS target, but this traces to mastering blogs rather than a named authority — treat it as a rough rule of thumb, not gospel.

### 3. Warmth / Analog Glue for Sterile Digital Mixes

Digital audio is cleaner and more precise but can sound "colder, flatter, less alive" because it lacks the cumulative harmonic coloration that analog tape, tubes, transformers, and consoles added at every gain stage. Saturation re-introduces this. The CONVENTION for "analog glue":

- **Individual-track saturation** shapes the *character* of one element (a dull vocal, a flat bass). Use more here.
- **Bus/mix-bus saturation** adds *cohesion* — the harmonics and gentle compression make disparate elements feel like they belong together. Use much less.

The widely-endorsed mix-bus approach (Sound on Sound's "Saturation Strategies," Sonarworks, MasteringBox): a "little, compounded across most tracks and/or subgroups, goes a long way." Sound on Sound notes that saturation plug-ins act as a "primer" that makes subsequent compressors and limiters "sound that little bit more forgiving," and that rounding transients on kick/snare makes later compression more consistent. **Watch for "bloat in the low mids" when stacking saturation across channels, groups, and the mix bus** — this is the most common failure mode of the "analog console emulation on every channel" approach. On a mix bus, conventions converge on roughly 1–2 dB of drive equivalent and a "felt-more-than-heard" result.

### 4. Parameter-by-Parameter Audible Effects

**Drive / input gain.** Controls how hard the signal hits the nonlinearity — more drive = more harmonics + more compression. This is the single most consequential control (more impactful than the character/type choice). Because it also raises level, always compensate with the output knob. Starting points: for subtle warmth, push until the saturation indicator just lights, then back off; for aggression, push well past that point.

**Mix / parallel (dry/wet) blend.** Blends the saturated (wet) signal with the clean (dry). Why parallel preserves transients: the dry path passes the original sharp attack and full dynamics untouched, while the wet path adds harmonic density underneath. This lets you use *aggressive* saturation settings (which alone would smear transients and flatten dynamics) while keeping snap and clarity. Yamaha/Baby Audio convention: in a true parallel (send/aux) setup, set the plugin's own mix to 100% wet and blend with the aux fader; as an insert, lower the plugin's mix knob. Critical for bass: blend dry sub back in so saturation's midrange enhancement doesn't reduce the booming low end.

**Tone controls (pre/post EQ, tilt).** Shape the harmonics. A pre-EQ changes what hits the saturator (cut a harsh 3 kHz peak *before* saturating so it isn't amplified). A post-EQ/tone tilt shapes the generated harmonics (e.g., Decapitator's single Tone knob tilts dark-to-bright; FabFilter Saturn 2 has per-band bass/mid/treble/presence). High-cut filters tame harsh high-frequency harmonics and aliasing.

**Asymmetry / bias.** Controls the even/odd harmonic balance. A symmetric curve (clips both halves equally) produces odd harmonics; an asymmetric curve (a bias offset that clips one half more) introduces even harmonics. This is why tubes (asymmetric) are "even/warm" and transistors (symmetric) are "odd/edgy." Some plugins expose this as a "bias" or asymmetry control; bias toward even harmonics for thickness without edge.

**Oversampling.** Nonlinear processing creates harmonics that can exceed the Nyquist frequency (half the sample rate; 22.05 kHz at 44.1 kHz). Those harmonics can't be represented, so they "fold back" (alias) into the audible range as *inharmonic* (non-musical) frequencies that sound "metallic, brittle, or digital." Oversampling temporarily raises the internal sample rate (2x, 4x, 8x), does the nonlinear math with more frequency headroom, filters, then downsamples — drastically reducing aliasing. **When to enable:** on saturators, clippers, and exciters, especially with high drive and on the master/mix bus where it affects everything. **Convention:** 2x–4x is sufficient for most cases; 8x+ is usually wasted CPU. The FabFilter Saturn 2 manual states that "using Good mode (8 times oversampling) will be more than sufficient to suppress possible aliasing in most cases." If you work at 88.2/96 kHz natively, you need less or none. **Audible artifacts of aliasing:** unnatural metallic tones, non-harmonic "junk" in the highs, and a subtly "digital" quality that compounds across many plugins. Note that oversampling does NOT fix intermodulation distortion — if a saturator still sounds bad with oversampling on, the IMD may be the issue.

### 5. Bitcrushing / Downsampling for Lo-Fi and Aggressive Textures

A bitcrusher degrades digital audio in two independent ways:

**Bit-depth reduction (resolution / quantization).** Bit depth sets how many amplitude values each sample can take: 24-bit ≈ 16 million values, 16-bit = 65,536, 8-bit = 256, 4-bit = 16. Reducing it forces the waveform into coarser steps, producing **quantization noise** (which sounds like low-pass-filtered white noise / a gritty hiss correlated with the signal) and reducing dynamic range. Character benchmarks: **12-bit** = subtle vintage-sampler grit/warmth; **8-bit** = clearly crunchy, "retro game console" (Sega) texture; **6-bit** = the resolution of the Roland TR-909's hi-hat, ride and crash samples (its kick/snare/toms are analog — engineer Atsushi Hoshiai sampled the cymbals at 6-bit/~18 kHz; the 909 was released in 1983 at $1,195 with only ~10,000 units built); **4-bit** = harsh, broken, Game Boy-style; at extreme reduction waveforms collapse toward square-wave clicks and buzzes. Pro tip: boost level into the crusher so the signal dominates the fixed-level quantization noise.

**Sample-rate reduction / downsampling.** Takes fewer "snapshots" per second, lowering the effective Nyquist and folding high frequencies back as **aliasing** — the characteristic "metallic/digital" inharmonic clangor. It sounds "more chaotic and harder to control" than bit reduction. It does NOT change pitch (a common misconception). It goes from interesting to unusable quickly.

**Creative uses in EDM:** lo-fi warmth on melodies/vocals (12-bit + ~22 kHz resample softens highs and adds subtle grit); aggressive snare/drum edge that standard saturation can't replicate; glitch/transition effects by automating bit depth down during a breakdown then snapping back; degraded "broken" textures. **Always pair with a low-pass filter** to tame harsh aliasing: ~5–7 kHz for heavy distortion, ~10–12 kHz for a gentle top-end soften. A slight dip at 2–3 kHz clears nasal/hollow tones; a small 200–400 Hz boost restores body. Bit reduction stays musical at more settings than sample-rate reduction, so reach for it first.

### 6. Harmonic Excitement of Dull Elements

**The core distinction:** EQ can only boost or cut frequencies that *already exist* in the signal — it cannot add what isn't there. An **exciter generates new harmonic content** (typically in the upper mids/highs) that wasn't present, creating the impression of air, presence, and detail. As Practical Music Production states, EQ "can't add anything extra that isn't already there. Exciters actually add extra harmonic content." This is why boosting a high shelf on a dull source just amplifies hiss/noise and turns harsh, whereas an exciter adds clean new "sparkle." An exciter is structurally a high-pass filter → distortion (harmonic generation) → blended back with the dry signal, so only the top end gets new harmonics while lows/mids stay natural.

**Exciter vs saturator:** a saturator thickens/warms broadly across the spectrum; an exciter is surgical and focused on highs. The original Aphex Aural Exciter (first offered in 1975, and so prized it was initially rentable only at a fee per minute of finished recording) used **Tune, Harmonics, and Mix** controls — Tune sets the base frequency where excitation begins, Harmonics sets the density of added distortion, and Mix the blend.

**Conventions and cautions:** use sparingly — "the moment you can clearly hear it, you've gone too far." Set the internal filter fairly high and the mix fairly low. Multiband exciters (Ozone, Neutron) are safer than full-band. Engage oversampling to avoid aliasing in the generated highs. **Strong caution from professional engineers:** an exciter should NOT be a crutch for a dull mix — if the *whole* mix is dull, fix the mix or the source, don't slap an exciter on the 2-bus. Many mastering engineers dislike exciters for the artifacts they can leave; this is partly a matter of TASTE.

### 7. Where Saturation Is the WRONG Tool

This is the most important corrective principle for amateurs:

**Removing existing unwanted distortion or harshness is an EQ or source-replacement job — NOT a job for more saturation.** Saturation *adds* harmonics; it cannot remove them. If a sound is harsh at 3 kHz and you add a saturator, the saturator "doesn't just preserve it — it amplifies it and creates new harmonics around it," so you get harshness at 3 kHz PLUS new harshness at 6 and 9 kHz. The correct order is **EQ first, then saturate** — cut the problem frequency so the saturator works from clean material. RAVEYARD's hard-techno guide presents this as the near-universal professional chain.

**For harshness specifically,** the right tools are surgical/dynamic EQ, a de-esser, or dedicated de-harshing plugins (oeksound soothe2, TDR/TokyoDawn, Ozone Spectral Shaper). A subtle warm *tape* saturator can sometimes round harsh transients, but that's a careful tonal-smoothing exception, not a fix for a real distortion problem.

**Where saturation muddies, masks, or worsens:**
- **Too much** moves past the "sweet spot": harmonics from one source mask the fundamentals of another (saturated bass at 200–400 Hz competes with vocal fundamentals; saturated vocals at 4–8 kHz compete with cymbals/air).
- **Dynamic range loss:** over-saturation flattens transients and removes the contrast that gives music life.
- **The "louder = better" trap:** saturated signals sound louder/denser and the brain reads that as "better" — a psychoacoustic bias, not a quality judgment. Always level-match (use auto-gain) before deciding.
- **Stacking saturation to fix problems** multiplies the issue. If a track sounds harsh and has more than three plugins, bypass them all and find the real culprit rather than adding more.
- **Low-end mud:** stacking saturation across channels/buses bloats the low-mids.

### 8. Exact Starting Points

> **Universal rules first (CONVENTIONS):** (1) Level-match using the output/auto-gain knob before judging — louder is not better. (2) EQ before saturation. (3) Use parallel blending for anything aggressive. (4) Enable 2x–4x oversampling on saturators/clippers. (5) Drive is set by ear to the source's "sweet spot," so treat all numbers below as starting points, not targets.

**By GOAL:**

| Goal | Type | Drive | Mix | Tone / notes |
|---|---|---|---|---|
| Subtle warmth | Tube/triode or tape | low — just lights the meter | 100% insert or 20–35% parallel | neutral; "felt more than heard" |
| Analog glue (bus) | Tape or console | ~1–2 dB equivalent | 100% (subtle) | watch low-mid bloat |
| Aggressive distortion | Transistor/pentode, hard clip | high, past the sweet spot | blend ~10–40% parallel | high-cut harsh tops |
| Loudness/density | Tube/transformer "maximizer" | moderate (~20%) | 100% | midrange focus (300 Hz–3 kHz) |
| Lo-fi texture | Bitcrush 12-bit + 22 kHz | n/a | to taste | LPF 5–12 kHz after |
| Excitement/air | Exciter (multiband, highs) | low | low (filter high, mix low) | oversample on |

**By ELEMENT TYPE (EDM):**
- **Kick:** Tape or soft-clip to add weight/controlled punch; drive the low end to thicken sub. A hard clipper on the transient adds loudness/punch while taming peaks. Decapitator "A" (Ampex, thick low-end harmonics) or "E."
- **Sub bass / 808:** The translation workhorse. Multiband: keep the sub band (below ~100 Hz) clean and mono; saturate/distort the midrange (100–800 Hz) so harmonics carry on small speakers. Tube/tape at ~10–20% drive enhances upper harmonics while keeping lows intact; parallel distortion (~40% mix on the mid layer) keeps the sub clean. Bias toward even harmonics (15–30% drive) for thickness. Always check in mono. Decapitator and Ableton/Logic Overdrive are common choices.
- **Bass (synth):** Tube saturation to generate upper harmonics so it translates on small speakers — the fundamental stays clean while harmonics add audibility. Softube Saturation Knob's "Keep High" mode "focuses distortion on the lows and mids to keep the high-end relatively clean," ideal for beefing a bass while leaving the top untouched.
- **Lead synth:** Transistor/pentode for aggressive grit, or a hard-clip curve for cutting modern leads; tanh for analog fatness on wavetables. Push harder than for warmth.
- **Pad:** Tube/triode for warm, musical body; gentle drive; keep dynamics so it stays lush. Tape adds cohesive vintage character.
- **Vocal:** Light tape or tube for warmth/presence; place the exciter after compression, before final EQ. Use the wet-signal high-shelf to tame sibilance the saturation adds. Parallel distortion adds crunch/clarity without overt distortion — watch for phase cancellation between the dry and distorted paths.
- **Drum bus:** Gentle tape for glue (the compression + harmonics glue dynamically and tonally). Decapitator "E" or "T" at Drive 1–3, Mix ~20–35%. Or parallel: duplicate the bus, distort heavily, blend to taste — great when drums sound "too clean/sterile."
- **Hi-hats / percussion:** Decapitator "P"/"T" hit hard with a mostly-dry parallel blend for sizzle. Softube's "Keep Low" mode "focuses distortion on the mids and highs to keep the low-end intact." Watch for harshness — these live in the ear's most sensitive zone.
- **Snare / clap:** Transistor for crack and bite (push hard for aggressive genres). For body, a low-mid-focused tube/tape "round" (Decapitator with HPF ~50 Hz, LPF ~12 kHz). For top-end crack, high-frequency-favoring saturation blended in at ~10% mix parallel; keep any following compressor's attack ≥1 ms so the constructed transient survives.
- **Master / mix bus:** Very gentle tape (1–2 dB drive) for cohesion; or multiband so you can drive only the high-mids and avoid bass overloading the distortion. Always mix in parallel — MusicRadar advises to "try a subtle 2–5% to begin." Enable oversampling and consider linear phase. Decapitator "A" gently tames a bright mix toward warm tape tone. Less is more.

**Plugin reference (free → pro):** Softube Saturation Knob (free; one knob + 3 modes: Keep High / Neutral / Keep Low), Klanghelm IVGI (free, dynamic), CHOW Tape (free tape) → Soundtoys Decapitator (5 analog styles A/E/N/T/P + Punish + Auto-gain) → FabFilter Saturn 2 (multiband, 28 styles, per-band drive/mix/dynamics/tone, 8x/32x oversampling, linear phase, modulation) → iZotope Ozone/Neutron Exciter and Plasma (adaptive tube).

## Recommendations

**Stage 1 — Before you reach for saturation.** Confirm the problem. If the issue is *harshness, mud, or unwanted distortion*, stop: use EQ, a de-esser, or replace the source. Saturation will make these worse. Benchmark to change course: if bypassing all plugins on a harsh track removes the harshness, the cause is your processing chain, not a lack of warmth.

**Stage 2 — Choose type by goal, set drive by ear.** Pick tube/tape for warmth/glue, transistor/clipper for aggression, bitcrusher for lo-fi. Set drive to the sweet spot (just past where the effect becomes audible), then **immediately level-match** with the output/auto-gain knob and A/B. Threshold to back off: if the level-matched "after" doesn't clearly beat the "before," remove or reduce it.

**Stage 3 — Protect transients and lows.** For anything beyond gentle warmth, use parallel blending (100% wet on an aux, blend with the fader; or 20–40% on an insert mix knob). For bass, keep the sub clean and mono and only saturate the mids. Check everything in mono.

**Stage 4 — Bus and master.** Add small amounts early so you mix into them. Mix bus: ~1–2 dB drive / 2–5% parallel, oversampling on. If you hear low-mid bloat, pull back the per-channel saturation first.

**Stage 5 — Quality control.** Enable 2x–4x oversampling on every saturator/clipper/exciter. Take ear-fatigue breaks. Compare on phone/laptop/earbuds specifically to verify bass translation. Reference against a commercial track in your genre.

## Caveats
- **Even/odd parity is a useful heuristic, not a law.** Drive level and pre/post EQ shape the result more than harmonic parity; many respected engineers consider the even/odd distinction overstated.
- **Specific numbers are starting points.** Drive percentages, mix percentages, and dB figures vary enormously by source material, plugin, and gain staging. The "1–2 dB of loudness from saturation" figure comes from mastering blogs, not a named authority.
- **Book quotes:** Bob Katz's most quotable statements here come from his Stereophile column, a TapeOp interview, and his Digido writings rather than verified verbatim pages of *Mastering Audio: The Art and the Science* (whose Chapters 17–18 cover analog coloration and depth). Mike Senior's bass-translation and parallel-distortion guidance is from *Mixing Secrets for the Small Studio* (Chapters 1 and 12), where he notes distortion "can add mid-range emphasis so that the sound carries through better on small speakers" but cautions that parallel distortion can cause "undesirable phase-cancellation with the undistorted sound."
- **Exciter control labels:** the original Aphex Aural Exciter used Tune/Harmonics/Mix; the "Drive/Tune/Mix" label set sometimes cited online belongs to later Big Bottom / Type III plug-in iterations.
- **Source-quality note:** much parameter-specific advice online comes from plugin-marketing blogs and AI-generated content (e.g., Grokipedia, some aggregator posts). This guide prioritizes primary manufacturer docs (FabFilter, Soundtoys, Softube, iZotope), Sound on Sound, and named engineers, and flags lower-authority figures.
- **Aliasing audibility is debated.** Independent tests show Decapitator aliases at 44.1 kHz but typically at inaudible levels; whether it matters depends on cumulative use and trained ears. This is partly TASTE.