# The EDM Stereo, Mid-Side & Panning Playbook: Exact Starting Values with Mono-Compatibility Standards Flagged

## TL;DR
- **Keep everything below ~100–120 Hz in mono — this is a hard technical standard**, not taste: stereo bass phase-cancels on mono club PAs, loses energy, and physically throws the cutting stylus out of the groove on vinyl. Everything above ~300 Hz, and the choice of *how wide* to go, is taste and varies by subgenre (techno tightest, trance widest).
- **Use "real" width (detuned unison, true-stereo layers, mid/side, decorrelation/Stereoize) and avoid "fake" width (Haas/short delay) on anything important**, because Haas comb-filters and can vanish in mono. Watch a correlation meter: aim for an average around +0.75 on the full mix (EDMProd), and never sit sustained negative.
- **Keep the core mono and centered (kick, sub, lead, snare/clap fundamental, lead vocal); widen only the periphery (pads, supersaws, plucks, reverbs, risers, atmospheres).** Counter-pan percussion left/right for an even field, and check mono on every change.

## Key Findings

1. **Mono low end is the one non-negotiable.** Authorities cluster the crossover at **100–120 Hz** for general work, with vinyl-bound masters going as high as **150–300 Hz**. Below this, summing to mono is a technical requirement for club and vinyl playback.
2. **Two physical reasons, not superstition.** (a) Club/PA subwoofer arrays and most consumer subs are fed a single mono signal; stereo/out-of-phase bass cancels and loses headroom. (b) Vinyl cutting: out-of-phase low frequencies make the cutter/stylus jump the groove, causing skips and distortion.
3. **Width that survives mono is "real" width** — detuned unison/supersaw spread, true-stereo layering, mid/side balance, and proper decorrelation (Ozone Stereoize, Velvet-Noise). **Haas/short-delay widening is "fake"** — it sounds huge in stereo but comb-filters and collapses in mono.
4. **The phantom center must stay strong.** Keep mid louder than side; the moment side energy exceeds mid, mono playback loses more than it keeps.
5. **Correlation meter targets:** +1 = mono-safe/identical, 0 = maximally wide but still mono-compatible, −1 = cancels in mono. Keep the full mix between 0 and +1; brief dips below 0 are fine, sustained negatives are not.
6. **Per-genre width is a spectrum:** techno/tech house are deliberately narrow and club-mono-focused; trance, future bass and melodic/progressive house are widest (lush supersaws and pads); big room widens the breakdown but narrows the drop lead for impact.

## Details

### 1. MONO-ING THE LOW END (hard standard)

**The convention.** Sum everything below a crossover frequency to mono. Recommended starting values from authoritative sources:

- **100–120 Hz** is the most common general recommendation. The mix:analog mastering blog, KVR mastering contributors, and numerous engineers cite 100–120 Hz with a 6–12 dB/oct slope. FabFilter Pro-Q in mid/side mode cutting the side channel "around 120 Hz with a 6 dB per octave slope" is a frequently cited concrete setting.
- **For vinyl**, go higher and be more conservative. Breed Media's vinyl-mastering guide states that "engineers often start narrowing the stereo field around 300 Hz, aiming for full mono between 150 and 120 Hz," because out-of-phase bass causes "an unstable groove that some needles can't track." Mobineko's vinyl notes: "the 150 Hz setting is chosen" for most modern tracks; an elliptical EQ with a 75–300 Hz crossover is the "absolute stop"; treat "anything under 150 Hz as a total 'no go area' for stereo bass."
- **The psychoacoustic floor is ~80 Hz.** Below roughly 80–90 Hz the ear cannot localize a pure sine via phase/level cues (standard psychoacoustics; J.J. Johnston, Wikipedia sound-localization summary), so centering this range costs nothing spatially while gaining energy and stability. Note: AES-cited research (Stewart/Hill, on ResearchGate) shows spatial *effects* are detectable down to ~40 Hz and direction changes as small as 10° can be detected for noise bursts from 31.5 Hz — so "you can't hear bass direction at all" is an oversimplification; the practical mono rationale is energy/headroom and playback-system summing, not pure inability to localize.

**WHY stereo bass fails (the rationale, all technical):**
- **Phase cancellation on mono systems.** When L and R sum, out-of-phase low frequencies cancel; bass loses level and punch. Long wavelengths make even small timing mismatches cause dramatic low-frequency cancellation.
- **Club/PA subs are mono.** Flotown Mastering: "many clubs may have an entire row or stack of subs, however they're certainly not running in stereo. In fact many times the entire sound system is mono to provide a more consistent experience for club goers as they move around." So if bass will be reproduced in mono anyway, control it at the source.
- **Vinyl cutting.** Streaky Mastering: elliptical EQs monoed bass under a selected frequency because "vinyl cutting lathes don't like bass that is out of phase as it makes the stylus jump out of the groove." Sound on Sound's Hugh Robjohns notes the correlation meter itself "was an essential tool for cutting vinyl records, to ensure the stylus wouldn't be thrown out of the groove by any strong out-of-phase components." Masterdisk's caution: heavy mono-ing is destructive and ideally left to the cutting engineer — but for amateurs, keeping 0–150 Hz mono "will make a record 'punch' more."
- **Headroom/energy loss.** Collapsing out-of-phase low end wastes headroom and weakens the mix's foundation.

**Tools & exact settings:**
- **Ableton Utility — "Bass Mono"** (Live 10+): built-in mono-frequency control. Set the crossover to **100–120 Hz** for general EDM, up to 150 Hz for club/vinyl. (Width knob: 0% = mono, 100% = unchanged, up to 400% = super-wide.) Florian (Production Music Live/Ableton forum): keep energy-delivering elements mono below ~250 Hz; "300 Hz is far too high."
- **Ableton EQ Eight in M/S mode:** switch to M/S, select the Side band, high-pass the side channel up to your crossover (~100–120 Hz). Cleaner and more surgical than the Utility chains.
- **iZotope Ozone Imager:** uses **linear-phase crossovers**, so you can pull the low band's width slider to −100 with no phase/image shift (Flotown confirms). Note it will not *recover* existing antiphase content — it only removes width going forward.
- **Brainworx bx_control / bx_digital:** "mono-maker" frequency control; a Gearspace user widening supersaws for live used bx_control to make lows/low-mids mono while keeping the top stereo, which kept the mono/stereo level difference small.
- **Tone Projects Basslane (free) / Basslane Pro:** purpose-built bass-mono tool with vectorscope feedback.
- **NUGEN Monofilter, Waves S1/Center, MeldaProduction MStereoProcessor:** all offer frequency-dependent mono control. NUGEN Monofilter can even recover antiphase bass to mono (with some phase rotation).
- **Verification:** drop a Utility set to 0% width (mono) on the master; the full spectrum should still be audible if you've done it right.

### 2. WIDENING THAT SURVIVES MONO COLLAPSE

**What to widen (peripheral, non-essential):** pads, supersaws/chord stacks, plucks, arps, reverb tails, FX risers/sweeps, background synths, atmospheres, backing vocals. Mike Senior (Sound on Sound) on the chart/EDM trick of widening a reverb to give the "outside the speakers" illusion: such a reverb "will have such dreadful mono-compatibility that it may pretty much vanish in mono, [but] that's rarely a great loss in practice, because the reverb serves no musical function. Better to lose some reverb in mono, than an important musical line!"

**What to keep mono/centered (the core):** kick, bass/sub, main lead synth, snare/clap fundamental, lead vocal. These carry the mix's energy and musical information and must survive mono. (Big-room producers even narrow/mono the drop lead for maximum impact.)

**Techniques that SURVIVE mono vs CANCEL:**
- **Detuned unison/supersaw spread (REAL width).** Multiple oscillators detuned and spread create genuine L/R differences that mostly survive. Caveat: with low detune + high blend the patch is "wide on headphones but the stereo image may disappear through a mono speaker" (CMUSE unison guide). For bass, keep unison voices few and spread narrow. Deadmau5-style wide saws survive mono because the meat sits centered. A pro trick (Echo Sound Works/ADSR Serum): resample a unison supersaw into a single-oscillator wavetable — "because it's a single oscillator, the phase correlation remains tight, even when played in mono."
- **True-stereo layering / double-tracking (REAL).** Two genuinely different takes/patches panned L/R give organic width with far fewer mono problems than processed width.
- **Mid/Side EQ widening (REAL, in moderation).** Boosting side or attenuating mid increases width; survives mono as long as mid stays dominant. Our ears perceive width most from mid-range side energy, not highs (Mastering.com).
- **Decorrelation / allpass / Velvet-Noise (REAL).** iZotope's Ozone 9 Imager docs state verbatim: "The Stereoize effect is completely mono compatible… Mode I: Haas Effect-based decorrelation processing. Mode II: A newly developed alternative… helps to preserve transients at higher settings." Allpass decorrelation creates width that survives mono with only mild spectral ripple (KERN Audio: "typically less than 1 to 2 dB").
- **Chorus / dimension expanders (mostly REAL but check).** A gentle chorus on a pad adds safe width; heavy chorus on bass makes it stereo and vinyl-hostile.
- **Stereo reverb (REAL for periphery).** Fine on pads/FX; keep it off the centered core and high-passed so it doesn't muddy the low end.
- **Haas / short delay (FAKE — dangerous).** Copies the signal with a short offset (1–35 ms). KERN Audio: in mono this sums to a comb filter with "deep periodic notches spaced at 1/delay Hz — a 10 ms delay creates notches every 100 Hz, a 20 ms delay creates notches every 50 Hz," with notch depths "of 10 to 18 dB" (versus allpass decorrelation's gentle 1–2 dB ripple). These hollow out the mix on every mono device. Mitigations (iZotope, eMastered): EQ/filter the delayed copy, don't hard-pan the dry signal, or push delay past ~20 ms until comb-filtering audibly stops (Attack Magazine settled on 20 ms and added a third mono duplicate so nothing is lost in mono).

**Keeping a strong phantom center while widening:** The governing rule (KERN Audio): on mono fold-down the side cancels and only the mid survives, so **keep mid louder than side**. "If everything is wide, nothing is wide" — keep a mono/centered anchor layer under wide elements. For bass specifically, the proven approach (WEAPON, Future Music) is **mono sub + stereo body**: a mono sub anchor (40–120 Hz) plus a separate harmonic layer high-passed at 100–120 Hz that you widen freely.

**Exact width starting points:**
- Ableton Utility width: 100% = unchanged; **120–140%** for a subtle widen on pads; mono = 0%.
- Ozone Imager **Width +25%** is already "a bit exaggerated to ensure it comes across on earbuds"; Stereoize Mode II **width 50–60%** on a mono source gives lush width while staying balanced. As a master-bus widener, **1.2–1.6×** is a safe starting range (Gearspace house/techno thread).
- Synth unison: supersaw lead **7–9 voices, detune to where it "just starts to sound out of tune," unison width near max**; bass **1–2 voices, minimal/no spread**.

### 3. MID/SIDE GAIN BALANCING

- **Keep mid dominant.** Side should be a fraction of total energy; when side exceeds mid, mono playback "loses more energy than it keeps" (KERN). On headphones, over-boosted sides sound like the mix is "coming from outside your skull in an ugly, disorienting way" (LordReverb) — if it sounds brilliant on speakers and ridiculous on headphones, halve the side boost.
- **Bob Katz's MS restraint rule (named source):** in his URM Academy Podcast EP12 interview, Katz states: "if you have to alter the ratio of M to S more than a db, you're probably going to cause a compromise. And I'm almost always very subtle… Less is more." For tonal M/S EQ, Producer Hive's rule of thumb is to keep adjustments under **±4 dB** with low-Q curves.
- **M/S EQ moves for EDM:** high-pass the side channel at your bass crossover (~100–120 Hz) to keep low end mono; cut "soupy" side energy in the low-mids (100–500 Hz) for clarity; add a gentle side high-shelf (e.g., +a few dB at 8 kHz) for air/width. iZotope's caution: don't over-boost side or the mix feels "discombobulated" after 30 seconds and the kit "feels less real."
- **Metering:** use a correlation meter and a vectorscope/goniometer (taller-than-wide = healthy stereo; a 45°-leaning line = out of phase). Mastering The Mix LEVELS flags low-frequency width (engage FILTER, high-cut ≤250 Hz, keep lows green/central).

### 4. REPAIRING NEGATIVE CORRELATION & PHANTOM WIDTH

**Reading the meter** (Sound on Sound, Logic, Apple, Reason all agree):
- **+1** = L/R identical/in-phase = mono (fully mono-safe).
- **0** = "the widest permissible left/right channel divergence" = wide but still mono-compatible.
- **−1** = identical but opposite polarity = "mutes the entire stereo signal when played in mono."
- Anything between +1 and 0 is mono-compatible; dips toward −1 mean coloration or cancellation in mono.

**Targets:**
- Sound on Sound (Hugh Robjohns): "Normal stereo material will generally display a fluctuating reading between +1 and zero"; any *steady* negative reading means something will be lost in mono.
- LinkedIn pro guidance: keep the coefficient varying **between +0.5 and +1** for enough width plus mono compatibility.
- EDMProd rule of thumb: aim as close to +1 as possible — "Staying around an average of 0.75 is a good rule of thumb, as the mix can change over time… as long as it stays mostly above 0, you're good. Drums and bass will be closer to 1.00."
- For sub/low-mids specifically (WEAPON): keep the meter **above +0.7, ideally +0.9 to +1.0 below 100 Hz**; if it dips negative in the sub range, fix immediately.

**Fixing over-pushed "phantom width":** When an imager pushed past ~100% drives correlation negative (Logic explicitly notes width/spread above 100% produces negative readings), the artifacts are "fake width" that disappears or sounds weird in mono. Remediation: (1) back the imager/width down until correlation returns to 0…+1; (2) high-pass the side below ~120 Hz; (3) use a *mono-compatible* widener (Ozone Stereoize) instead; (4) for problem material, NUGEN Monofilter can recover antiphase bass; (5) use a multi-band correlation meter (free Voxengo Correlometer) to find which band is negative. LordReverb: if a mix arrives reading below 0, M/S processing won't fix it — fix the source.

### 5. PAN-BALANCING LEFT/RIGHT (even field)

- **Goal:** even energy L vs R. Use a balance meter (Mastering The Mix LEVELS L-R meter glows red when lopsided; default tolerance 0.3, loosen to 0.6 if you pan heavily) and a vectorscope/goniometer.
- **Counter-panning (the core technique):** for every element panned one way, pan a frequency-similar element the other way. Music Guy Mixing: pan a tambourine/shaker to the opposite side of the hi-hat (they share a frequency range, so this balances). Gearspace EDM consensus: "If you have some high hats panned right, try to have some other upper-frequency stuff panned left."
- **Mono check exposes imbalance:** collapse to mono regularly; lopsided or vanishing elements reveal phase/balance problems.
- **Note pan vs balance:** on stereo tracks in Logic the "pan" knob is a *balance* control by default (changes L/R level rather than repositioning) — right-click to switch to Stereo Pan if you want true repositioning.

### 6. PER-ELEMENT PAN POSITION CHART (typical EDM kit)

Scale: **−100 (hard L) … 0 (center) … +100 (hard R)**. (In Ableton, 50 = hard pan, so halve these numbers; e.g., 30% ≈ Live's "15".) Centered low/lead elements are **mono-compatibility-sensitive**; off-center percussion is **taste**.

| Element | Pan start | Type | Notes |
|---|---|---|---|
| Kick | **0 (center)** | Standard | Always centered + mono; the heartbeat/low-end anchor |
| Sub/Bass | **0 (center)** | Standard | Mono below ~100–120 Hz; anchor |
| Lead synth (main) | **0 (center)** | Mostly standard | Keep centered/mono so it survives club mono |
| Lead vocal | **0 (center)** | Standard | Centered phantom-center element |
| Snare/Clap (fundamental) | **0**, or **±10–20** | Taste | Often dead center; slight offset (≤±20) gives it room |
| Closed hi-hats | **±15 to ±30** (one side) | Taste | ~30% off-center "works well" (Music Guy Mixing) |
| Open hi-hats | **±15 to ±30** | Taste | Pair opposite a counter-element |
| Toms (rack) | **±15 to ±30** | Taste | Spread for natural fills |
| Floor tom | **±25 to ±30** | Taste | Opposite the hi-hat |
| Congas/bongos | **±45 to ±90** | Taste | "More radical" panning for exotic perc |
| Shakers/tambourine | **±10 to ±30** | Taste | Pan opposite the hi-hat to balance |
| Claves/cowbell/blocks | **±30 to ±60** | Taste | Place on the sides, balanced |
| Ride cymbal | **±20 to ±40** | Taste | Matches overhead/perc placement |
| Crash | **±30 to ±100** (or paired L/R) | Taste | Two crashes panned opposite sides |
| Secondary leads | **±20 to ±50** | Taste | Off-center so they don't fight the main lead |
| Arps | **±20 to ±50** or wide | Taste | Can also be stereo-widened |
| Plucks | **±20 to ±50** or wide | Taste | Widen via unison/stereo |
| Pads | **Wide (stereo)** | Taste | Widen, don't hard-pan; keep mid dominant |
| Backing vocals | **±30 to ±60** or wide | Taste | Sides, out of the lead's way |
| FX/risers/sweeps | **Wide / automated** | Taste | Automate L↔R for movement |

Hard rule baked in: **kick, sub, lead, lead vocal centered**; everything else is creative. (Skrillex-style panned/automated kicks exist but are deliberate effects, not defaults.)

### 7. PER-GENRE / SUBGENRE WIDTH CONVENTIONS

These are **taste conventions, not standards** (the mono-bass rule applies to all). Width below is expressed roughly as side-energy measured above ~200 Hz; treat as relative guidance. One consistent published framework (TrackScore.AI, an AI-generated mix-analysis source — credible-but-not-authoritative) plus producer/educator sources:

| Subgenre | Relative width | Approx. width (above ~200 Hz) | Convention |
|---|---|---|---|
| **Techno** (peak-time/industrial) | Narrowest | **~15–25%** | Mono power is the point; kick, bass, main perc near-mono; club-oriented |
| **Tech house** | Narrow | **~20–35%** | Tight, centered; width from percussion/FX |
| **Minimal/deep techno** | Narrow | **~15–25%** | Hypnotic center focus |
| **Drum & Bass** | Split | mono <300 Hz, **very wide above** | Sub dead-center mono, mids/highs super-wide; "identical in mono" |
| **Dubstep / riddim** | Split | mono <200 Hz, **wide mids** | Sub mono/centered; mid-bass growl wide; automate FX width |
| **Big room** | Contrast | Wide breakdown / **narrow-mono drop** | Widen pads in breakdown; narrow/mono drop lead for impact |
| **Deep house** | Moderate | **~25–40%** | Wider pads/reverbs for warmth |
| **Future bass** | Wide | high (no firm %) | Lush wide detuned supersaw chords + mono sub |
| **Melodic/Progressive house** | Wide | **~30–50%** | Lush synths, long reverb tails |
| **Trance** | Widest | **~35–55%** | Wide supersaw leads + layered lush pads |
| **Ambient/downtempo** | Widest | **~40–60%** | Max immersion; mono compatibility less critical |

Cross-genre rules: techno/tech house deliberately tighter and more centered; melodic/progressive/trance/future bass widest (built on supersaws and pads); all keep **bass/sub mono and kick centered**. Production Music Live: "Use a mono low-end, narrow low-mids and wider in the mids and extreme highs." A useful spectral shape: **mono <150 Hz → narrow 150–500 Hz → moderate 500 Hz–5 kHz → widest >5 kHz**.

### 8. QUICK-REFERENCE STARTING VALUES

| Parameter | Starting value | Flag |
|---|---|---|
| Bass-mono crossover (general EDM) | **100–120 Hz** | STANDARD |
| Bass-mono crossover (vinyl) | **150 Hz** (up to 300) | STANDARD |
| Mono-maker slope | **6–12 dB/oct** | Standard/taste |
| Side high-pass (M/S EQ) | **~120 Hz, 6 dB/oct** | STANDARD |
| Full-mix correlation target | **avg ~+0.75**, never sustained negative | STANDARD |
| Sub-band correlation (<100 Hz) | **+0.9 to +1.0** | STANDARD |
| Master-bus widener | **1.2–1.6×** | Taste |
| Ozone Imager width (pad/master) | **+25%** (subtle) | Taste |
| Ozone Stereoize Mode II width | **50–60%** | Taste |
| Hi-hat pan | **±15 to ±30** | Taste |
| Toms pan | **±15 to ±30** | Taste |
| Exotic perc pan | **±45 to ±90** | Taste |
| M/S EQ adjustment ceiling | **±4 dB** (Katz: M/S ratio change >1 dB risks compromise) | Taste/guideline |
| Supersaw lead unison | **7–9 voices, wide** | Taste |
| Bass unison | **1–2 voices, narrow** | STANDARD-ish |
| Haas delay (if used, non-core only) | **≥20 ms, filtered** | Taste (risky) |

## Recommendations

**Stage 1 — Set the foundation (do this on every track).**
1. Put a mono-maker (Ableton Utility Bass Mono, Ozone Imager low band, or EQ Eight M/S side high-pass) at **100–120 Hz** on the bass bus and/or master. This is non-negotiable for club/vinyl.
2. Center kick, sub, main lead, and lead vocal at 0. Confirm with a mono check.
3. Insert a correlation meter on the master. Establish your baseline.

**Stage 2 — Build width on the periphery only.**
4. Widen pads/supersaws/plucks/FX using detuned unison, true-stereo layers, M/S, or Ozone Stereoize — never on the centered core.
5. Keep mid louder than side at all times. If a wide element sounds thin or disappears in mono, it's fake (likely Haas) width — replace it with a mono-compatible method.
6. Counter-pan percussion (hat one side, shaker/tambourine the other) and check the L-R balance meter.

**Stage 3 — Verify and dial to genre.**
7. Mono-check after every significant change. The standard: if it survives mono, ship it.
8. Match width to subgenre: pull width down toward techno's 15–25% for club/tech material; push pads/leads wide (35–55%) for trance/future bass. Big room: wide breakdown, mono drop lead.

**Thresholds that change the advice:**
- **Correlation sits sustained below 0** → stop; reduce imager width, high-pass the side, or fix the offending element before doing anything else.
- **Mix is vinyl-bound** → raise the mono crossover to 150 Hz, tame dynamic low-frequency width, and consult your cutting engineer (per Masterdisk, leave aggressive mono-ing to them).
- **Element vanishes/thins in mono** → it depends on fake width; rebuild with unison/true-stereo/decorrelation.
- **L-R balance meter glows red / leans one side** → counter-pan a frequency-matched element to the opposite side.

## Caveats

- **Standard vs taste:** Mono bass below ~100–120 Hz, kick/sub centering, and avoiding sustained negative correlation are **technical mono-compatibility standards** driven by club-PA mono summing and vinyl physics. Specific width percentages, per-element pan amounts, subgenre conventions, M/S balance, and which elements to widen are **aesthetic choices** that vary by producer and track.
- **The mono-bass rule has dissenters.** Some modern engineers (Hyperbits) argue stereo bass is now a viable creative choice since most playback can reproduce it, and Flotown notes "a little low-frequency width is not nearly as problematic as many would lead you to believe" if controlled dynamically. The conservative, universally safe default remains mono below ~100–120 Hz — especially for anything club- or vinyl-bound.
- **"Can't localize bass" is oversimplified.** The deeper rationale for mono bass is energy/headroom and the fact that playback systems sum low end to mono — not a total inability to hear bass direction (research shows some low-frequency localization is possible).
- **Source quality:** Numeric per-subgenre width percentages derive substantially from TrackScore.AI, an AI-generated marketing source using its own 200 Hz-HPF measurement method — internally consistent and reasonable but **not an industry standard**; treat as convention. EDMProd's +0.75 correlation target and the various producer-educator figures are rules of thumb, not laws. The correlation-meter scale definitions, the Haas/comb-filter math, the vinyl rationale, and Ozone/Ableton tool behaviors are well-corroborated across multiple authoritative sources (Sound on Sound, iZotope, Apple/Logic, KERN Audio, mastering engineers).
- **No verbatim Bob Katz correlation number found.** Katz's documented positions are his M/S restraint rule (M/S ratio change >1 dB "probably going to cause a compromise"), his treatment of bass/center as mono, and the K-System loudness calibration (83 dB SPL/speaker) — not a specific correlation target. The −1/0/+1 framework here is best attributed to Sound on Sound's Hugh Robjohns and the DAW manufacturers.