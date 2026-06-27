# The EDM Producer's Reference to Reverb & Delay: Parameter-Precise Depth & Ambience

**Scope note:** Every numeric value below is a *starting point*, not a rule. Exact settings depend on the source sound, the mix context, and the specific reverb/delay algorithm (a "2-second" decay on a bright digital plate behaves nothing like 2 seconds on a dark hall). Where a number is a near-universal convention, it is marked **[CONVENTION]**. Where it is genre/taste-dependent or contested, it is marked **[TASTE]**.

## TL;DR

- **Three sends cover ~90% of EDM:** one short room/ambience (≈0.3–0.8 s) to glue, one longer plate/hall (≈1.5–4 s) for depth, and one tempo-synced delay — all on 100%-wet return buses, fed by send knobs. This is established professional convention.
- **Two moves matter more than any preset:** (1) pre-delay (≈10–40 ms, or tempo-synced) to keep transients/consonants clear ahead of the tail; (2) high-pass the reverb/delay *return* (~200–600 Hz) and low-pass it (~6–10 kHz) so the wet signal stops muddying the low-mids. Skipping the return EQ is the #1 cause of amateur "wash."
- **Genre dictates tail length and dryness:** trance/melodic house lean on lush long reverbs and dotted-1/8 delays; techno favors short bright rooms plus filtered dub delays sidechained to the kick; dubstep/DnB keep the drop and drums tight and largely dry. A muddy buildup is usually a 200–500 Hz EQ problem, not a reverb-amount problem.

## Key Findings

1. **Reverb type should be chosen before parameters.** Plate = bright/dense, cuts through, ideal on snare/clap and lead vocals; Hall = long/lush, for pads and single feature elements but muddies fast if overused; Room = short/natural, the cohesion-and-glue tool; Ambience/early-reflection = "felt not heard," tightens drums and glues; Spring/Chamber = character effects. (Sweetwater, Valhalla DSP, Mixing Lessons.)
2. **Pre-delay is the clarity lever.** 0 ms = source glued into the space (pushed back); 20–40 ms = transient punches through before the tail. It is independent of decay, so you can have a long tail *and* a clear source. Tempo-sync it with `ms = 60000 / BPM` math.
3. **Send/return beats inserts for time-based FX**: 100% wet on the return, shared across elements for one coherent space and major CPU savings. Convention.
4. **Delay divisions are functional:** 1/4 = spacious/obvious; 1/8 = rhythmic fill; dotted-1/8 = the "Edge"/syncopated lead device; 1/16 = thickening/flutter; triplets = swing. Feedback ~25% ≈ 3 repeats, ~50% ≈ 6, ~75% ≈ 10+. Filter and saturate the repeats so they sit back.
5. **Depth = contrast.** Near vs far is created by the *relationship* between dry and wet elements, level, brightness, pre-delay and wet amount — not by the reverb alone. As FabFilter's reverb guide puts it, "more pre-delay will also result in the direct sound to appear closer... in a larger space it will take more time for the sound to be reflected back to us."
6. **When ambience is wrong:** a muddy buildup in 200–500 Hz is an EQ/arrangement/sidechain problem. Reaching for more or less reverb won't fix a frequency-masking or mono-compatibility issue.

## Details

### 1. Reverb Types and Element Suitability

| Type | Sonic character | Typical decay (RT60) | Best EDM uses | Why |
|---|---|---|---|---|
| **Room** | Short, natural, tight; sparse early reflections, warm | ~0.3–1.0 s | Drums/percussion, glue across whole mix, plucks, "presence" on leads | Adds size without an obvious tail; quickly builds echo density so sounds feel "in a place" rather than "in a canyon." A small room (~300–500 ms) run across many elements is a classic glue trick. |
| **Ambience / early-reflection** | "Felt, not heard"; mostly early energy, very short, colorless | ≤0.5 s | Tightening drums, gluing a mix, adding subtle depth to dry sources | Early reflections "generally occur within the first 50 milliseconds and play an important role to create the character and size of a room" (FabFilter). Mike Senior's "blend" reverb uses exactly this: in *Mixing Secrets for the Small Studio*, he reduces the decay of a preset to ~500 ms for "a brief, well-defined burst of reflections rather than an echoey delay tail" to pull too-upfront elements together. |
| **Plate** | Bright, dense, smooth, instant high echo density; slightly metallic | ~1–3 s (snare often ~0.5–1.8 s) | Snare/clap, lead vocals, plucks, synth stabs | No real-room geometry → dense shimmer that cuts through dense mixes and adds sustain/sparkle without low-end build. The reason "plate on snare/vocal" is a cliché. |
| **Hall** | Long, lush, layered, spacious | ~1.5–5 s+ | Pads, atmospheres, breakdown leads, a single feature element | Long layered tails thicken sustained sounds; but apply to one element at a time or the mix washes out. |
| **Chamber** | Like a room but deeper/thicker, colored, vintage | ~1–3 s | Percussion, vocals, giving body to synths | More character than a room, smoother than a plate. |
| **Spring** | Boingy, bright, no clear early reflections, vintage | variable | Dub/techno effect, character on synths/guitars; *not* on sharp transients | Mechanical, unnatural — used for vibe (dub techno especially). Bad on drums due to "boing." |
| **Shimmer / Bloom (creative)** | Pitch-shifted (octave-up) wash; slow build | very long / "infinite" | Ambient pads, future bass/melodic-house atmospheres | Dominates a mix — a little goes a long way (Valhalla). |

**Kick and bass:** keep largely dry **[CONVENTION]** — reverb on lows muddies and pushes them back. Exceptions: filter the lows out of a reverb and use it only on the kick's top end for "flavor," or sidechain a wet kick-reverb to the kick for dub-techno rumble.

### 2. Core Parameters with Exact Guidance

**Decay / RT60 (per goal):**
- Tightening drums / glue: **0.3–0.8 s**
- Snare/clap width & sustain: **~0.5 s** typical, up to ~1.8 s for a big plate
- Leads/plucks presence: **0.8–1.5 s**
- Pads/atmosphere/depth: **2–4 s** (longer in breakdowns)
- Ambient/downtempo washes: **3–8 s+** (cathedral/shimmer territory)
- Fast genres (DnB, techno): keep short, **0.3–0.8 s**, so tails die before the next hit. A common technique: tune room reverb so one snare's tail dies just before the next snare hit.

**Pre-delay — how it works and exact ranges.** Pre-delay is the gap between the dry sound and the onset of the reverb tail, modeling the time direct sound takes to reach the first reflective surface. Because it is *independent* of decay, it lets a long, lush tail coexist with a clear, punchy source: without it, the tail smears over the initial transient and masks the detail (a vocal's consonants, a snare's crack) that makes the source feel alive. Even 5 ms moves the first reflection off the transient and audibly cleans things up.
- Intimate/small space: **0–10 ms**
- Rooms/medium: **10–20 ms**
- Drums/percussion: **10–25 ms** (snare sweet spot 10–20 ms)
- Vocals: **20–40 ms** (some engineers push to 50 ms+ for spaciousness)
- Halls/large: **30–80 ms** (distance effects up to ~90–110 ms)

*Tempo-syncing pre-delay:* a quarter note in ms = `60000 / BPM`. At 128 BPM a quarter note = 468.75 ms, an eighth = 234 ms, a 1/16 = 117 ms, a 1/64 ≈ 29 ms. For pre-delay, short divisions (1/64, 1/128) are most useful since they preserve transients. If your reverb's pre-delay isn't tempo-syncable, insert a tempo-synced delay (feedback **0%**, 100% wet) *before* the reverb so the first reflection always lands on the beat (Sweetwater).

**Damping / HF damping:** controls how fast highs decay vs lows in the tail. More damping = darker, warmer, more "absorbed" (carpet/curtains); less = brighter, more metallic/lively. Keep damping *lower* on plates to preserve their characteristic brightness; raise it to make a big hall sit back. Typical HF damping cutoffs sit around 4.5–10 kHz in classic patches (Sound on Sound).

**Wet/dry & send levels:**
- Insert reverb: usually **10–30% wet** for depth; even **1%** can de-"booth" a dry vocal.
- Send/return reverb: return is **100% wet [CONVENTION]**; control amount with send knobs. Useful method: raise the send until the reverb is just too present, then back off slightly.
- Insert delay: start **15–25% mix**; the rule of thumb is the wet should not exceed ~50% or repeats become louder than reality.

**Diffusion, size, modulation (briefly):** Diffusion = how quickly individual echoes smear into a smooth wash (high = smooth/dense, good for sustained sounds; low = discrete/grainy, can sound metallic). Size = the perceived dimensions of the space (scales early-reflection spacing). Modulation/"swirl"/chorus on the tail (subtle, low rate) keeps a digital reverb from sounding static and helps long tails feel natural; push it for creative, seasick textures.

### 3. Send/Return vs Insert Reverb

Use **inserts** only for: a dedicated effect on a single element (e.g., a snare-only plate, gated reverb, a sound-design effect), or when you want the reverb baked into that one channel. Use **sends/returns** for everything time-based and shared. Signal flow: the dry channel goes to the master *and* a portion is "sent" to an aux bus carrying a 100%-wet reverb/delay; the wet return comes back on its own fader.

Benefits of the shared-send approach (all established convention):
- **Cohesion / glue:** all elements routed to one reverb sound like they share a real acoustic space. Separate reverbs on every channel sound like a collage of disconnected rooms.
- **CPU:** one instance serves many tracks.
- **Independent wet processing:** you can EQ/compress/saturate the return without touching the dry — essential for the high-pass-the-return move and for sidechain-ducking the reverb.
- **Why 100% wet:** the dry already exists on the source channel; any dry bleed in the return just adds level and can cause phase interactions. Set the return wet, control with sends.

Most mixes want **no more than 2–3 reverbs** plus spot effects. A robust template: short room/ambience + long plate/hall + tempo-synced delay (+ optional second/creative delay).

### 4. Tempo-Synced Delay for Rhythm and Width

`Delay time (ms) = (60000 / BPM) × note multiplier.` Dotted = ×1.5; triplet = ×2/3. At 120 BPM: 1/4 = 500 ms, dotted-1/8 = 375 ms, 1/8 = 250 ms, 1/8-triplet ≈ 167 ms, 1/16 = 125 ms.

**Division uses:**
- **1/4:** spacious, obvious echoes; ballad/breakdown throws.
- **1/8:** rhythmic fill that reinforces the groove.
- **Dotted-1/8:** the syncopated "between the notes" device (see Edge trick below) — the signature lead/arp delay in trance, prog/melodic house.
- **1/16:** thickening, "flutter," tight doubling.
- **Triplets:** swung/shuffled feel; great on ad-libs and percussion.

**Feedback ↔ repeats:** ~**25% ≈ 3 repeats**, **50% ≈ 6**, **75% ≈ 10+**; 100% = self-oscillation (careful). Keep below ~50% for most musical uses. On a busy lead, low feedback (one or two repeats) prevents the delay stepping on the next note; for dub-style wash, raise feedback and filter heavily.

**Ping-pong** for width: echoes alternate hard-left/hard-right (the right delay = ping time + pong time). Set mode to ping-pong, width to max, feedback <50%. Very short ping-pong (e.g., 30 ms, one side polarity-inverted) is an excellent transparent widener with good mono compatibility (Sound on Sound).

**Tone/filtering of repeats (the key to delays that don't clutter):** filter the feedback path — high-pass ~250–400 Hz to kill low-mid buildup and low-pass ~6–8 kHz (or as low as ~1.2 kHz for tape-style) so repeats get progressively duller and sit *behind* the dry source. Saturation/modulation on repeats (tape wow/flutter, slight distortion) makes each repeat less defined, so it conflicts less and sounds more distant. Many delays (Soundtoys EchoBoy, FabFilter Timeless, Logic Tape Delay) put EQ in the feedback loop for this.

**The dotted-1/8 "Edge"/U2 trick:** play steady notes while a dotted-eighth delay fills the gaps, creating a galloping 16th-note pattern. At 105 BPM ≈ 430 ms; at 130 BPM ≈ 346 ms. The Edge's documented studio rig used *two* delays in series: per the engineer breakdown circulated on the U2 Guitar Tutorial Forums, "First delay is mixed at about 28%. A single repeat (zero feedback)... an 1/8th note. Second delay (main delay you actually hear) mixed at 48-50%, 3 or 4 repeats... a dotted 1/8th note," with low filtering at 125–250 Hz and high filtering at 4 or 8 kHz on the repeats. In EDM, this is the go-to on plucks/arps/leads in trance and progressive/melodic house. **[TASTE]** which exact division — any time that lands repeats between your notes works.

**Slapback and short delays:** single 80–200 ms repeat, near-zero feedback — adds presence/"doubling" without an obvious echo; common on synthwave/80s vocals. Haas-style 10–30 ms single-side delay widens a mono source (watch mono compatibility).

### 5. Front-to-Back Depth and Glue

Depth is **contrast**: it's the *relationship* between dry and wet, loud and quiet, bright and dark — not the effect in isolation. If everything is equally wet you lose all sense of front-to-back. Depth cues you control:
- **Level:** quieter = further.
- **Wet amount + pre-delay:** more reverb / shorter pre-delay = further back; less reverb / longer pre-delay = closer and clearer (FabFilter).
- **Brightness:** roll off highs (and a little low) on distant elements; keep close elements bright (a little 7–10 kHz "air").
- **Delay/echo with rolled-off repeats** simulates distance better than reverb alone.

**Layer depths deliberately:** kick/bass and lead vocal up front and dry; snare on a medium plate; pads on a long hall far back. A shared short room/ambience reverb across drums, plus a shared bigger reverb across melodic elements, places everything in one coherent space and glues the mix. A house/techno classic: send *only* the delay return into the reverb (no dry into the verb), so the "far" space is built from the delay tails.

### 6. The High-Pass / Low-Pass the Return Move **[CONVENTION]**

This is the single most important reverb/delay cleanliness move. Reverb adds energy across the whole spectrum: lows pile into the 200–500 Hz mud zone and the sub region (stealing headroom and clarity from kick/bass), while highs exaggerate sibilance and harshness. EQ the wet signal to keep only the part that adds depth.

- **High-pass the return:** typical **200–400 Hz** for general use; the **Abbey Road trick** — which, per Soundfly's Flypaper, "was invented at Abbey Road Studios to help create space in mixes" — calls for "a high pass filter and filter out everything below 600 Hz," then "a low pass filter and filter out everything above 10 kHz," so the reverb lives only in the mids. On vocals, ~300–500 Hz HPF is common.
- **Low-pass the return:** **~6–10 kHz** (drop to ~5–6 kHz to tame harsh/sibilant tails or for a darker, more vintage, more "transparent" reverb that can sit louder).
- **Where:** pre-reverb EQ (on the send) changes what the algorithm receives (Abbey Road style); post-reverb EQ (on the return) sculpts the generated tail (plates can sound metallic and need taming). Either works — Production Expert's Julian Rodgers notes that for unmodulated reverbs, EQ placed before vs after the reverb "null to silence," so the practical difference is mostly about whether you're shaping what feeds the algorithm or the tail it produces. Doing both is fine.

Why it matters: you can add far more reverb before the mix clogs if you've filtered the return. The reflexive amateur fix — lowering the send because the mix got muddy — usually just makes things dry *and* still muddy. Filter first, then add the depth you actually wanted.

### 7. When Ambience Is the Wrong Tool

- **Mud is usually an EQ problem, not a reverb problem.** Most "wash"/mud lives in **200–500 Hz** where nearly every element overlaps. If a buildup appears when parts stack, reach for *subtractive EQ* — on the dry source and/or the reverb return — before changing reverb settings. Find the dominant element in the low-mids, give it that territory, and cut 2–4 dB around it on everything else.
- **Reverb won't buy arrangement space.** If the section is too busy, the fix is muting/arrangement, not more ambience. "Sometimes a muddy mix is just too many tracks competing for limited space."
- **Sidechaining, not reverb,** solves kick/bass masking and keeps a wet mix punchy (duck the reverb/bass to the kick).
- **Mono compatibility:** wide stereo reverb/short delays can comb-filter or collapse on mono systems; keep everything below ~120 Hz mono, and check the reverb in mono. A width or phase problem is not solved by changing decay.
- **Shorten the tail instead of fighting it:** a 4 s hall that's gorgeous in solo often just needs to be 1.5–2 s in the mix.

### 8. Exact Starting-Point Tables

**Per element (generic EDM starting points — adjust to tempo/track):**

| Element | Reverb type | Decay | Pre-delay | Damping/EQ | Wet (insert) / send | Delay |
|---|---|---|---|---|---|---|
| **Lead synth** | Plate or hall | 0.8–1.5 s | 20–40 ms (≈40 ms is a common lead figure) | LPF return ~7–8 kHz | 10–20% / moderate | Dotted-1/8 or 1/8, feedback 20–35% |
| **Pad** | Hall / shimmer | 2–4 s+ | 10–30 ms | HPF return 200–300 Hz, LPF 6–8 kHz | 20–40% | optional 1/4, low feedback |
| **Pluck** | Room or plate | 0.6–1.2 s | 10–20 ms | HPF ~300 Hz | 10–25% | Dotted-1/8, feedback ~25% |
| **Vocal** | Plate (+ hall for size) | 1–2.5 s | 20–40 ms (up to 50+) | HPF 300–500 Hz, LPF 6–8 kHz; sidechain-duck to dry | 10–25% | 1/8 or 1/4, HPF 250–400 Hz / LPF 6–8 kHz on repeats |
| **Snare / clap** | Plate or room | 0.5 s (to ~1.8 s big) | 10–20 ms | Band-pass ~600 Hz–6 kHz (Abbey Road) | insert ~100% wet at low level, or send | optional short slap |
| **Hi-hats / perc** | Room / ambience | 0.3–0.8 s | 0–15 ms | HPF ~300–500 Hz | low send | 3/16 or 1/16 ping-pong for movement |
| **Kick** | (mostly dry) | — | — | if used: HPF the reverb so only top end | very low / none | none |
| **Bass** | (dry) | — | — | reverb avoided; sidechain instead | none | none |
| **Risers / FX** | Hall / big | 3–8 s | 0–50 ms | automate HPF opening up into the drop | automate send up, cut at drop | 1/4 or 1/2 with high feedback |

*Snare reverb specifics:* upfront/tight = slightly longer pre-delay + short tail + fast decay; washy/back = fast pre-delay + longer tail + slower decay. Gated reverb (long plate/hall → noise gate, hold ~300 ms, release ~70 ms) = the 80s/synthwave "exploding snare."

**Per genre (tendencies + starting points):**

| Genre | Tempo | Reverb tendency | Delay tendency | Kick/bass & drop | Notes |
|---|---|---|---|---|---|
| **Progressive / melodic house** | 122–128 | Chords on a *small/medium hall* with pre-delay ~0; pads on long lush tails (Valhalla Supermassive/Shimmer) | **Dotted-1/8** is the signature (e.g., ~20% wet, low-cut ~100 Hz); arps "washed out" with plenty of delay | Slow "pumping" sidechain on bass; drops often stripped to kick+bass+1 element, fairly dry | Delay provides size so the chord reverb can stay small (NI/Sara Simms). Low-cut delay ~100 Hz, EQ reverbed chords below ~150 Hz. |
| **Deep house** | 118–125 | Used *sparingly*; short rooms + light plate; HPF the send to protect lows | Dub delays for texture; sometimes free-running (un-synced) to avoid phasing | Kick punchy, gentle sidechain | "Less is more"; effects stick out if low quality (Loopmasters/MusicRadar). |
| **Tech house** | 120–127 | Short rooms for clarity + filtered space for groove | 1/8, dotted-1/16; ping-pong on perc | Tight, dry low end; sidechain returns to kick | Reverb mostly on higher-frequency sounds. |
| **Techno** | 125–135 | Short bright rooms on percussion (claps/snares to a 1–2 s send, Valhalla VintageVerb) + a long dark/filtered atmosphere reverb (Attack Magazine "Beat Dissected" shows e.g. decay ~3.79 s on an FX verb); sidechain the reverb to the kick | **3/16** on rides/hats and vocals (EDMProd); stereo/offset delays; automate feedback for builds | Kick dry/punchy (or wet+sidechain-ducked for rumble); drop slams back in | "Not 8–16 s Berlin reverbs" for rolling techno; ~10% wet on clap FX. HPF reverb, LPF ~10 kHz on background groups. |
| **Trance** | 130–142 | *Lush, long* reverbs (2–4 s, longer in breakdowns; ~0.8–1.5 s at the drop); often 3 reverbs (room + plate + big) | Heavy **dotted-1/8 / 3/16 ping-pong** on leads; delay→reverb chaining | Kick/bass dry & sidechained; dry up the lead at the drop | ~40 ms pre-delay on lead is a widely-repeated anchor; 15–25% delay wet; HPF/EQ sends to stay clean. |
| **Dubstep / riddim / bass music** | 140 (half-time feel) | Keep the **drop dry**; reverb/delay used for contrast and in build-ups (automate wet 10%→40% then cut before drop); vocal chops ~1–1.5 s decay ~20% wet | Sparse; throws and build FX | One bass element at a time; sub mono & centered; kick/bass dry and forward | Clap/snare reverb ~40% insert, cut below ~500 Hz (Sound on Sound, Dodge & Fuski). "Use reverb/delay sparingly." Tails can be huge as a *creative* effect. |
| **Drum & bass** | 170–175 | Short, tight reverbs (0.3–0.8 s); two-verb snare trick (short room + 1.5–4 s tail timed to die by next hit) | Tight, short; minimal on the rolling section | Sub owns the bottom (mono); transients preserved (transient shaping, not heavy comp) | Mud is 150–500 Hz, not the sub. HPF returns aggressively. |
| **Future bass** | 140–160 (half-time) | Big lush hall/shimmer on supersaw chords; convolution ~1.4 s for thickening | 1/4 / dotted-1/8 on chops; ping-pong for width | Sub clean & centered; sidechain pump | Cut reverb tails when the chord stops to keep wobble tight; cut highs on the reverb so it doesn't fight the saws. |
| **Synthwave** | 80–118 | *Liberal* plate/hall (gated reverb on snare is iconic: long plate → gate, hold ~300 ms/release ~70 ms); chamber/plate sheen on everything | **Slapback** (80–200 ms) and 1/8 on vocals/leads | Modern punchy kick; snare hits on offbeats | Lexicon-style plates define the era; pre-delay 20–50 ms before the gated verb. |
| **Ambient / downtempo** | 60–110 | *Very long* halls/shimmer/bloom (3–8 s, up to 30 s / "freeze"); layered short + long | Long delays 300–800 ms, high feedback, modulated; cascading | Often no drums; depth is the point | "A little shimmer dominates." Use long pre-delay (90–110 ms) and dark tails for vast distance. |

## Recommendations

**Stage 1 — Build the template (do this once).** Create three return buses: (a) **Ambience/Room** — small room, 0.3–0.6 s, pre-delay 0–10 ms, 100% wet, HPF ~250 Hz / LPF ~9 kHz; (b) **Plate/Hall** — 1.5–3 s, pre-delay 20–40 ms, 100% wet, HPF ~300 Hz / LPF ~7 kHz; (c) **Delay** — tempo-synced (1/8 and dotted-1/8 presets), feedback 25–35%, HPF ~300 Hz / LPF ~7 kHz in the feedback path. Route everything via sends. This alone fixes most amateur depth problems.

**Stage 2 — Place elements.** Keep kick and bass dry. Glue drums with bus (a). Put snare/clap/lead on a plate. Send pads/atmosphere to the hall. Add the genre-appropriate delay to leads/plucks/vocals. Set pre-delay to taste using the depth logic in §5.

**Stage 3 — Clean up (non-negotiable).** Before touching send levels, confirm every return is high-passed and low-passed (§6). A/B the return EQ on/off at matched level — if you can't hear a difference in-context, leave the filter on.

**Stage 4 — Genre-tune.** Apply the §8 genre row: lengthen and wetten for trance/ambient/melodic; shorten, filter and sidechain for techno/tech house; dry out the drop and drums for dubstep/DnB.

**Benchmarks that should change your approach:**
- If the mix muds up when parts stack → stop adjusting reverb; EQ-cut 200–500 Hz on dry sources (§7).
- If the low end loses punch → high-pass returns higher and/or sidechain the reverb to the kick.
- If delays clutter → lower feedback to 1–2 repeats and low-pass the repeats harder.
- If a tail sounds gorgeous soloed but vanishes/muddies in the mix → shorten decay (4 s → 1.5–2 s) rather than turning it up.
- If it sounds wide in stereo but collapses in mono → it's a width/phase problem; check mono, keep <120 Hz mono.

## Caveats

- All values are starting points; algorithm, source, and context dominate. A bright digital plate and a dark convolution hall at the same "2 s" sound completely different.
- Hard conventions (well-supported across sources): 100%-wet send returns; high-/low-passing the return; pre-delay to preserve transients; keeping sub/kick/bass mono and largely dry; sidechaining rather than reverb to fix kick/bass masking.
- Taste/genre-dependent (contested): exact tail lengths, how wet to go, dotted-1/8 vs other divisions, whether to use long "rule-breaking" tails. Forum/practitioner figures (e.g., specific trance pre-delay anchors, exact Edge delay percentages) are widely repeated and useful as starting points but are not laboratory-precise — and even within one source the Edge's "first delay" is sometimes quoted as a 1/8 slap and sometimes as ~28% mix, so treat them as recipes to taste.
- Monitoring matters: reverb reads louder on headphones than monitors, and an untreated room will make you over- or under-apply it. Reference on multiple systems and against commercial tracks in your genre.
- Genre tempo ranges are typical, not strict; convert note values to ms with `60000/BPM` for your actual project tempo.