# Rhythmic Modulation & Sidechain-Pumping: A Parameter-Dense Technical Reference

## TL;DR
- **Aesthetic pumping is its own discipline**: set a fast attack (0.01–1 ms), high ratio (4:1 to ∞:1), and a release tied to tempo (calculated as 60000/BPM = one quarter-note in ms) so gain reduction is *deliberately audible* — typically 3–6 dB for subtle pump, 6–12 dB for obvious, and near-total ducking for the extreme French-house effect. This is the opposite goal of corrective/glue compression, where 1–3 dB of gain reduction should stay *inaudible*.
- **Genre conventions differ concretely**: house/techno duck the bass to the four-on-the-floor kick and pump pads; trance layers gating/tremolo on pads and uses the whole-mix breathing effect; the sub-bass should generally NOT be broadband-ducked — use multiband or sidechain-EQ that touches only the kick's fundamental, and keep all sub frequencies mono/centered.
- **Modern practice favors volume-shapers** (LFOTool, Kickstart 2, VolumeShaper) over compressors for the pump because you draw the exact ducking curve; compressors win when you want dynamic, kick-reactive ducking. Tremolo, auto-pan, and trance gates add rhythmic movement to pads/leads/arps — never to the sub or kick.

## Key Findings

1. **The pump is a release-time phenomenon.** Every authoritative source agrees attack should be near-instant (so the kick transient punches through and the ducking starts immediately), while the *release* is the single most important parameter — it must be timed so the ducked element recovers just before the next kick. The math is universal: **60,000 ÷ BPM = milliseconds per quarter note**, then halve for eighths, halve again for sixteenths. Formally, "pumping" is a creative misuse of compression — per Wikipedia it is the "audible unnatural level changes associated primarily with the release of a compressor," and (per Alex Case) it can result from attack/release settings that are "too slow or too fast…or too, um, medium."
2. **Depth is the dial for "subtle vs. obvious."** ~2–3 dB = barely-there mix glue; 3–6 dB = musical, tasteful pump; 6–12 dB = the obvious EDM/big-room breathing effect; near-total ducking = extreme French-house/"vacuum" pump.
3. **The aesthetic/corrective line is real and practical.** Aesthetic pumping uses high ratios, tempo-synced releases, and visible gain-reduction. Corrective/glue compression uses low ratios (1.2:1–2:1), slow attacks (10–30 ms), auto/short releases, and 1–3 dB GR that listeners should *not* notice. Different solver, different settings.
4. **Trance gates, tremolo and auto-pan are tempo-synced LFO/envelope tools**, not dynamics processors — they run continuously regardless of input level, whereas sidechaining only ducks when the trigger fires.

## Details

### 1. The Genre-Defining Sidechain "Pump" on a Compressor

**Starting values (insert a compressor on the ducked track; feed the kick to its external sidechain input):**

| Parameter | Starting value | Why |
|---|---|---|
| **Attack** | 0.01–1 ms (fastest the comp allows) | The ducking must begin the instant the kick hits. Some producers nudge attack up slightly to let more of the kick *transient* pass before ducking starts. |
| **Release** | Tempo-synced (see math below); commonly ~½ of a quarter note (an eighth) for 4/4 kicks | Controls the audible "breathing." The bass should be fully recovered just before the next kick. |
| **Ratio** | 4:1 to 8:1 for obvious pump; 2:1 for subtle; up to ∞:1 for extreme | Higher ratio = deeper, more aggressive pump. |
| **Threshold** | Lower until you hit the target gain reduction | This (with ratio) sets pump depth. |
| **Gain reduction depth** | 3–6 dB subtle · 6–12 dB obvious · near-total = extreme | The "how much" of the effect. |

**Attack — controlling pump sharpness.** The consensus across sources is "as fast as possible" so the compressor pulls the bass down immediately. A truly instant attack locks the duck tightly to the kick; nudging attack to a few ms lets the kick's initial transient "poke through" before the duck engages, which preserves kick punch — the same logic used in glue compression but for a creative end. Note that on some compressors a sub-1 ms attack on certain sounds creates a click; lengthen attack slightly or switch compressor mode if so.

**Release — the heartbeat of the pump.** This is where the rhythm lives. Set release too short and the effect is inaudible; too long and the element never recovers before the next kick, producing a "jittery, stumbling" or muddy feel. The technique: start with the release near the eighth-note value for a 4/4 kick and adjust by ear using the gain-reduction meter so the needle returns to zero just before the next kick.

**The BPM-to-milliseconds math (memorize this):**
- **Quarter note (ms) = 60,000 ÷ BPM**
- Eighth note = quarter ÷ 2 · Sixteenth = quarter ÷ 4
- Dotted = straight × 1.5 · Triplet = straight × 0.667
- Worked example at **128 BPM**: 60,000 ÷ 128 = **468.75 ms** (quarter) → **234.4 ms** (eighth) → **117.2 ms** (sixteenth). Dotted eighth = 351.6 ms.

**Release values that pump well at common tempos** (quarter / eighth / sixteenth, rounded):

| BPM | ¼ note | ⅛ note | 1/16 note | Typical pump release (start here) |
|---|---|---|---|---|
| 124 | 483.9 ms | 241.9 ms | 121.0 ms | ~120–240 ms |
| 126 | 476.2 ms | 238.1 ms | 119.0 ms | ~120–240 ms |
| 128 | 468.8 ms | 234.4 ms | 117.2 ms | ~115–235 ms |
| 130 | 461.5 ms | 230.8 ms | 115.4 ms | ~115–230 ms |
| 132 | 454.5 ms | 227.3 ms | 113.6 ms | ~110–225 ms |
| 138 | 434.8 ms | 217.4 ms | 108.7 ms | ~110–215 ms |
| 140 | 428.6 ms | 214.3 ms | 107.1 ms | ~105–215 ms |

*Practical note:* compressor release behavior is not perfectly linear, so the synced number is a starting point — trust the gain-reduction meter and your ears. A common rule of thumb is to set release to roughly half the quarter-note value so the element fully recovers between on-beat kicks. Use the longer (quarter-note-ish) releases for slow, dramatic "deep house / progressive" breathing and the shorter (eighth/sixteenth) values for tighter, snappier pumps.

**Depth recommendations:**
- **2–3 dB GR** — subtle, almost mix-only ducking (overlaps with corrective territory).
- **3–6 dB GR** — the practical sweet spot for most genres; audible but musical.
- **6–12 dB GR** — obvious, energetic EDM/big-room pump.
- **Near-total ducking** — the extreme French-house "vacuum" where the rest of the mix disappears between kicks. Per Sound On Sound, the canonical reference is Daft Punk's "One More Time": "Every beat of the kick drum pulls the rest of the mix down… Check out the likes of Modjo, David Guetta and, of course, Daft Punk."

### 2. Which Elements to Pump and How Deep

| Element | Sidechain? | Typical depth | Notes |
|---|---|---|---|
| **Bass / mid-bass** | **Always** (the core relationship) | 3–6 dB standard; 9–15 dB for deeper genres | Kick and bass both live ~40–120 Hz and mask each other; ducking carves space. |
| **Sub-bass (<~100 Hz)** | **Not broadband** | a few dB, frequency-specific only | Duck only the kick's fundamental via dynamic EQ / multiband; keep sub mono & centered. Broadband ducking of the sub thins the low end. |
| **Pads / sustained synths** | Yes — benefit most | 6–18 dB | Long sustains swamp the mix; pumping adds movement. Progressive house ducks pads 12–18 dB with slow shaped release for drama. |
| **Leads** | Light, only if competing with the kick during the drop | 2–6 dB | Skip during kick-less breakdowns. |
| **Chords / stabs** | Only if sustained | 3–8 dB | Short percussive stabs usually don't need it. |
| **Reverb / delay returns** | Yes — cleans buildup | to taste | Ducking FX returns when the kick (or a dry vocal) hits prevents wash. Often triggered by the dry source. |
| **Full mix bus** | Genre-dependent (see conventions) | 1–4 dB | The whole-mix "breathing" effect; keep it modest or it sounds like an effect, not music. |

**Kick↔bass relationship vs. full-mix pump.** Two distinct jobs share one tool: (a) *kick-vs-bass ducking* is primarily a **mixing necessity** — it stops two low-frequency elements from fighting; (b) *full-mix or multi-element pumping* is a **rhythmic/aesthetic effect**. The same compressor move serves both, but the intent (and therefore the depth) differs.

**Sub-bass and frequency-specific considerations.** The preferred modern approach for kick-vs-sub is **sidechain dynamic EQ or multiband sidechain**: create a band at the kick's fundamental (often ~60–70 Hz) on the bass and make it duck dynamically only when the kick triggers. Multiband sidechain (Waves C6, Kickstart 2's Band mode, FabFilter Pro-Q dynamic band) ducks only the lows while mids/highs pass untouched — a far more natural pump in dense mixes. Always keep everything below ~100 Hz mono and centered; wide sub causes phase cancellation when summed to mono (clubs, Bluetooth speakers) and can make a vinyl cutting head jump.

### 3. Sidechain Techniques Beyond the Compressor

**Volume-shaper / LFO-tool / envelope plugins.** Instead of a compressor reacting to a trigger, these draw a tempo-synced volume curve:
- **Xfer LFOTool** — per Xfer's official spec, an "LFO with customizable point+tension-curve editor, 12 graphs in a preset… up to 4 graphs simultaneously," with band-split (set the split ~100 Hz to duck only lows), sync from 16 bars down to <1/256 note, and MIDI-triggering for non-4/4 patterns. It is a de-facto producer standard — named users (per Equipboard) include W&W ("The LFOTool we use a lot and really like. That is from Xfer") and Nicky Romero ("we'll take the LFO Tool today… I take a sidechain preset, and I just adjust it").
- **Cableguys VolumeShaper (in ShaperBox)** — drawable volume LFO across **3 independent frequency bands** (lows/mids/highs), beat-sync, MIDI or audio-transient triggering, and a "Show External Sidechain" view that overlays the kick so you draw the curve to match it.
- **Nicky Romero Kickstart 2** — the fastest option: drop on a track, pick from **16 hand-crafted curves** (per MusicTech, "10 for ducking and 6 for trimming the decayed part of the sound"), sync to **1/8, 1/4, 1/2 or 1/1**, drag the "Slope" to fit your kick length, with a **Mix knob** for parallel blend and a **Band split** for low-only ducking. Curves 9–10 are tuned specifically for sub-bass (slower fade-ups). Default ducks at the start of every beat. Both audio and MIDI modes use 6 ms of look-ahead smoothing so the fade happens just *before* the kick (audio mode adds 10 ms latency for accurate transient placement). Price: **€14 / $16** (Kickstart 1 owners upgrade for €5 / $5).

**Advantage:** precision and consistency — you get an identical, custom-shaped duck every beat (e.g., fast initial drop + slow curved recovery a compressor can't make). **Disadvantage:** it's static — it doesn't react to how hard the kick hits. For most house/EDM that consistency is desirable; switch to a compressor when you want organic, dynamic response.

**Ghost / phantom kick triggering.** Duplicate the kick channel, route the copy to the compressor's sidechain input, and **mute its output** (route to "sends only"). Benefits:
- Decouples the *trigger* from the *audible* kick — you can keep the pump going during sections where the real kick drops out (great for build-ups before a drop where you hear pumping but no kick).
- Lets you adjust ducking depth simply by changing the ghost-kick level.
- Lets you shape the trigger: replace the ghost sample with a short click/rimshot, or shorten its decay, so the duck has exactly the envelope you want (e.g., duck only on the transient even if your real kick is boomy).
- Lets you give the pump its own groove (offset/swing the ghost kick independent of the audible kick).
This is the standard way to get a 4/4 sidechain feel in trap/future-bass or behind irregular kick patterns.

### 4. Tremolo and Auto-Pan Motion

Both are LFO modulators. **Tremolo** modulates volume; **auto-pan** modulates left/right position (or volume, if phase is set to 0° = mono tremolo). Use them on pads, plucks, leads, arps, keys — **never on sub-bass or kick** (keep those mono/centered). Sync rate to tempo for rhythmic interest.

**Waveform/shape:** sine = smoothest; triangle = linear, slightly more pronounced; square = hard on/off chop (stutter/gate-like); saw = ramp (duck-and-recover, sidechain-like). Smoothing/symmetry controls round the shape to avoid clicks.

**Tremolo starting values:**
- Rate (synced): **1/8 or 1/16** for rhythmic pulsing; 1/4 for slow sway; triplet/dotted for groove variation.
- Depth: **~20% for the slightest hint of movement; 50% moderate; 77% for a strong-but-musical bounce; 100% for full chop.**
- Logic's stock Tremolo example for a rhythmic pad: **1/16 rate, Smoothing 26%, Symmetry 18%, Depth 77%.**
- Free-running (unsynced) for buzzing texture: a fast rate such as ~21.6 Hz with depth backed off to ~20%.

**Auto-pan starting values:**
- Rate (synced): **1/4 to rhythmically pan each beat**; 1/8 or 1/16 for faster stereo motion; for a mono "volume tremolo," set **Phase 0°**.
- Depth/Amount: **~10% subtle, ~30% moderate, up to 100% for hard left-right ping-pong.** A common recipe: set Amount to 100% to dial in the rate, then pull back to ~10% so the panning "adds life without standing out."
- For the Ableton Auto Pan-as-sidechain trick: **Amount 100%, Phase 0°**, synced rate (e.g., 1/4) to fake a volume pump.

**BPM-to-Hz for unsynced LFOs:** Hz = BPM ÷ 60 for a quarter-note rate. At 128 BPM a quarter = 2.13 Hz, an eighth = 4.27 Hz, a sixteenth = 8.53 Hz.

**Which elements:** pads, plucks, leads, arps, keys, and stereo FX benefit. Leave sub-bass, kick, and the central low end alone (mono/centered for translation).

### 5. Rhythmic Gating (Trance Gate)

A trance gate chops a sustained pad/chord/string into rhythmic stabs using a tempo-synced step sequencer (or a noise gate keyed by a muted rhythmic trigger). It only works on **sustained** material — pads, held chords, strings, sustained leads, noise — not on percussive or transient sounds.

**Two ways to build it:**
1. **Dedicated trance-gate plugin** (Kilohearts Trance Gate, FL Studio PoiZone gate, A1TriggerGate, Sylenth1's built-in gate) — program a 16-step pattern.
2. **Sidechained noise gate** — feed a muted 16th-note hi-hat / click track into a Gate's sidechain ("Audio From"), lower threshold until the rhythm appears, then shape with Attack/Hold/Release.

**Starting parameters:**

| Parameter | Starting value | Notes |
|---|---|---|
| **Rate / division** | **1/16** (16 steps per bar) — the genre standard | 1/32 for double-time fills; 1/16-triplet (12-step) for triplet feel. Division is tempo-independent. |
| **Pattern** | 16 steps, toggle on/off | Classic x0x-derived pattern alternates short bursts; start with every other 16th on, then syncopate. Tie/link adjacent steps for longer notes. |
| **Attack** | **1–5 ms** (never <1 ms → clicks) | How fast each burst opens. <1 ms produces clicks on non-zero-crossings. |
| **Hold** | **20–30 ms** (or set by step length) | Keeps the gate open through the step; prevents chatter. |
| **Release** | **20–100 ms** | Longer = smoother tails between stabs; shorter = tighter separation. |
| **Depth / Range / Floor** | **−80 to −90 dB for full chop; −3 to −12 dB for subtle pulsing** | How far the gate attenuates between stabs. |
| **Smoothing / look-ahead** | ~5 ms look-ahead; raise "smooth"/attack to kill clicks | FL's PoiZone has a dedicated SMOOTH knob; Kilohearts uses 5 ms look-ahead. |

*Programming convention:* lower Attack/Hold/Release increases the separation between bursts; higher values reduce it. Sustained, dense source material (overdriven/compressed signals, layered pads) gives the most consistent burst levels. Program the pattern against the track's percussion so it locks to the groove. Note: no single canonical ms preset exists in the literature — the 1/16 rate is a firm convention, but the envelope values above are assembled from general gating guidance and should be tuned to the source.

### 6. The Explicit Line: Aesthetic Pumping vs. Corrective Dynamics

This is the central conceptual distinction for this knowledge base.

| | **Aesthetic pumping (THIS solver)** | **Corrective dynamics (a DIFFERENT solver)** |
|---|---|---|
| **Goal** | Gain reduction is *the point* — audible, rhythmic groove | Gain reduction should be *inaudible* — level consistency, peak control, glue |
| **Ratio** | 4:1 → ∞:1 | 1.2:1 → 2:1 (glue); up to 4:1 drum bus |
| **Attack** | Fastest possible (0.01–1 ms) | Slow, 10–30 ms, to preserve transients |
| **Release** | Tempo-synced; long enough to *hear* the breathing | Fast/Auto; just enough to recover, no audible pump |
| **Gain reduction** | 3–12 dB, deliberately visible | 1–3 dB; "never exceed ~5 dB" on a master comp |
| **Trigger** | External (kick / ghost kick) | The signal itself (internal) |
| **Where** | Bass, pads, leads, FX returns, mix bus, for *feel* | Master/mix bus, vocals, instruments, for *control* |

**The rule:** when you *want* listeners to feel the gain move with the beat, that's aesthetic — push the settings. When the gain movement should disappear and you only want the mix to sit tighter, that's corrective — pull the settings back. A glue compressor on the mix bus (1.2:1–2:1, 10–30 ms attack, auto release, 2–3 dB GR, soft knee) is the corrective archetype; a kick-triggered comp on the bass (∞:1, 0.01 ms attack, eighth-note release, 8 dB GR) is the aesthetic archetype. The same plugin can do either — the numbers tell you which job it's doing. (Note: even mastering engineers exploit a *little* musical pumping for energy, so the line is a spectrum, not a wall — but the design intent is categorically different.)

### 7. Exact Starting-Value Matrix at Common EDM Tempos

**Sidechain compressor** (attack fastest available on all; ratio/depth to taste per genre):

| BPM | Attack | Release (pump start) | Ratio | Depth (GR) |
|---|---|---|---|---|
| 124 | 0.01–1 ms | 120–240 ms | 4:1–6:1 | 4–8 dB |
| 126 | 0.01–1 ms | 120–238 ms | 4:1–6:1 | 4–8 dB |
| 128 | 0.01–1 ms | 117–234 ms | 4:1–8:1 | 6–10 dB |
| 130 | 0.01–1 ms | 115–230 ms | 4:1–8:1 | 6–10 dB |
| 132 | 0.01–1 ms | 113–227 ms | 4:1–8:1 | 6–12 dB |
| 138 | 0.01–1 ms | 109–217 ms | 6:1–8:1 | 6–12 dB |
| 140 | 0.01–1 ms | 107–214 ms | 6:1–8:1 | 6–12 dB |

**Tremolo / Auto-pan / Gate** (sync divisions are tempo-independent; depth ranges constant across tempos):

| Effect | Rate / Division | Depth (subtle → strong) |
|---|---|---|
| **Tremolo** | 1/8 or 1/16 (1/4 for slow sway; triplet for groove) | ~20% → 50% → 77% → 100% |
| **Auto-pan** | 1/4 (1/8–1/16 for faster); Phase 0° = mono tremolo | ~10% → 30% → 100% |
| **Trance gate** | 1/16 (1/32 double-time; 1/16-triplet for swing) | Floor −3 to −12 dB (subtle) → −80/−90 dB (full chop); Attack 1–5 ms, Hold 20–30 ms, Release 20–100 ms |

### 8. Genre Conventions vs. Rules-of-Thumb

**Hard genre conventions (flagged as CONVENTION):**
- **House / techno (CONVENTION):** built on a four-on-the-floor kick; sidechaining the bass to the kick is effectively mandatory — both as a mixing necessity and the genre's groove signature. In techno it's described as "the heartbeat." Tech house tends to duck the bass deeper (9–15 dB, ~150–200 ms release at 126–128 BPM). On the origins of the popularized effect: per Wikipedia's "Pumping (audio)" article, "Eric Prydz's 'Call On Me' is credited with popularizing the technique, though Daft Punk's 'One More Time' contributed" — credit is shared rather than belonging solely to Daft Punk.
- **Trance (CONVENTION):** pumps the broader mix and leans heavily on **gated pads** and tremolo/auto-pan movement on supersaw leads/pads; the "whole mix breathing" is part of the aesthetic. Typical tempos 130–140 BPM.
- **Deep house (CONVENTION):** pronounced, smooth, slow-release sidechain (200–350 ms) on long evolving pads for that breathing feel, at 120–124 BPM.
- **Progressive house (CONVENTION):** deep, dramatic pad/synth sidechain (12–18 dB) used as a compositional tension/release tool, 126–130 BPM.
- **Disco house (CONVENTION):** *subtle* sidechain (3–6 dB, fast 80–120 ms release) to keep the organic groove — heavy pumping is avoided.
- **Sub-bass stays mono and is not broadband-ducked (CONVENTION across all genres).**

**Rules-of-thumb / starting points (tweak by ear):**
- All the specific ms/dB/ratio numbers above are *starting points*, not laws — "there is no ultimate truth," and the right value depends on your kick's envelope and the sound being ducked.
- Use the gain-reduction meter to time the release; the math gives you the ballpark, your ears confirm.
- Attack "fastest possible" is near-universal advice, but nudging it up slightly to preserve the kick transient is a legitimate taste choice.

**Where producers disagree / taste-dependent:**
- **Compressor vs. volume-shaper:** some pros use volume-shapers for ~90% of sidechain work (precision/consistency); others prefer a compressor for organic, kick-reactive feel. Both are valid.
- **How much full-mix pump:** a frequent warning is that over-pumping leads, vocals, and hi-hats makes a track "sound more like an effect than music" — restraint is widely recommended, but the "correct" amount is genre- and taste-dependent.
- **Whether to widen bass at all:** the orthodox rule is mono below ~100 Hz, but many modern producers widen harmonics above ~100–150 Hz while keeping the fundamental mono — acceptable as long as it survives a mono check and isn't being cut to vinyl.

## Recommendations

**Stage 1 — Get a working pump fast (beginner default):**
1. On the bass, insert your DAW's compressor; route the kick to its sidechain input.
2. Attack = fastest; Ratio = 4:1; pull threshold for ~6 dB GR.
3. Set release to the eighth-note value for your BPM (e.g., 234 ms at 128) and adjust with the GR meter so the bass recovers just before the next kick.
4. If it clicks or feels stiff, switch to **Kickstart 2** or **LFOTool**, pick a curve, sync to 1/4, drag the slope to your kick. *Benchmark to move on:* the kick punches cleanly and the bass "breathes" without disappearing or stumbling.

**Stage 2 — Refine by element and genre:**
- Duck pads 6–18 dB (more for progressive/trance), leads lightly (2–6 dB) and only during the drop, and FX returns to taste.
- Protect the sub: switch kick-vs-sub to **dynamic EQ / multiband** at the kick's fundamental (~60–70 Hz) instead of broadband ducking; confirm everything <100 Hz is mono. *Threshold to change approach:* if the low end thins or loses weight in mono, you're ducking the sub too broadly — go multiband.
- Add movement: tremolo (1/8–1/16, depth 20–77%) or auto-pan (1/4, depth 10–30%) on pads/arps; a trance gate (1/16, full-chop floor) to turn a held chord into stabs.

**Stage 3 — Keep aesthetic and corrective separate:**
- Do NOT use one compressor to both pump and glue. Use a kick-triggered comp/shaper for the *effect* and a separate low-ratio glue comp (1.2:1–2:1, 10–30 ms attack, auto release, 1–3 dB GR) for *cohesion* on the bus. *Benchmark:* if you can hear the mix-bus comp "breathing" and you didn't intend a pump, lower the ratio, slow the attack, or raise the threshold until the movement disappears.

**Tooling priorities for an amateur:** (1) learn the stock compressor sidechain to understand the parameters; (2) buy Kickstart 2 (€14 / $16) for fast, consistent pumps; (3) add LFOTool/ShaperBox when you need custom curves, band-split, or trance-gating in one tool.

## Caveats
- **Numbers are starting points.** Compressor release curves are non-linear and brand-dependent; a synced ms value is a target, not a guarantee — always confirm timing with the gain-reduction meter and your ears.
- **No single canonical trance-gate ms preset exists** in the literature; the rate (1/16) is a firm convention but attack/hold/release/floor values are assembled from general gating guidance and should be tuned to the source. The one hard rule: attack faster than ~1 ms causes clicks.
- **"Fastest attack" can click** on some material/compressors; lengthen slightly or change detection mode.
- **Tempo-specific divisions for tremolo/gate/auto-pan are not BPM-dependent** — a 1/16 gate is 1/16 of the bar at any tempo; only the resulting ms changes.
- **Genre boundaries blur.** The conventions above describe central tendencies; cross-pollination (e.g., 4/4 ghost-sidechain in trap) is common and legitimate.
- **Mono-summing and vinyl** impose hard limits on low-end width that override aesthetic width choices.
- Several cited figures come from producer blogs and forums (EDMProd, Abletunes, Ben Rainey, Sonarworks, Mastering The Mix, Behind The Speakers) rather than peer-reviewed sources; they represent strong community consensus but are conventions, not physics. Primary/official references include Cableguys (Kickstart 2/VolumeShaper docs), Xfer Records (LFOTool spec), Image-Line (PoiZone), Kilohearts (Trance Gate), Apple Logic Pro docs, Universal Audio (SSL bus comp), Sound On Sound, and Attack Magazine's *The Secrets of Dance Music Production*.