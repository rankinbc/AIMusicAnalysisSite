# Stem Handling Research — Better Approaches to Stem-Role Classification

**Date:** 2026-06-17
**Branch:** `research/stem-classification`
**Author:** Research session (read-only; no production code changed)
**Status:** Findings + recommendation

---

## TL;DR / Recommendation

**Stop requiring users to export and label stems. Make mix-only analysis the default, and derive stems automatically via source separation when per-stem fidelity is wanted.** The diagnosis below shows three independent problems: (1) the current spectral role classifier is genuinely weak; (2) the role *taxonomy* has no bucket for synths/keys, so it literally cannot label the user's session correctly; and (3) — most decisive — **the kind of export users naturally produce ("export all tracks") is unusable for stem analysis at all**: it contains FX-return buses, group sub-mixes that duplicate individual tracks, a loud sidechain utility track, and the master mix itself. Summing the real export reconstructs the mix at **2.62× the correct loudness and −0.08 correlation** — i.e. not at all. No classifier improvement can fix a bad input.

The good news: **the analysis math barely depends on roles.** Phase-4 clash detection and phase-5 reference deltas both already run on the **mix only**; stems are an *enrichment*. Roles are used mostly for human-readable attribution in three specialist verdicts, and the single most role-dependent piece of math (genre RMS balance flags) is **currently inert** because the pipeline never passes a genre profile. So mix-only analysis already captures most of the value today.

**Recommended architecture:** mix-only by default → optional automatic source separation (Spleeter / open-unmix umxhq at request time on CPU for analysis-grade stems; htdemucs on a GPU/serverless worker for an opt-in high-fidelity "listenable stems" path) → optional user-supplied stems remain as a power-user fidelity boost, but with a **bus/FX-return/duplicate guard** and **no manual role labeling** (roles auto-derived from separated-source alignment or a PANNs embedding probe). This removes the export burden and the labeling burden entirely from the default path.

---

## 1. How stem roles are used today (with code citations)

### 1.1 The base analysis does NOT need stems

Both stem-consuming phases compute their primary output from the **mix alone**; stems are attached as an optional `result["stems"]` enrichment.

- **Phase 4 (stem clash)** — `components/analysis/src/audio_analysis/phases/phase4_stems.py`. The active path is `_spectral_analyze(wav_path)` (lines 122–177), which loads the **mix** (`librosa.load(... mono=True)`), computes 7-band STFT energy, and emits clashes from **absolute band thresholds on the mix** ("low-end buildup", "low-mid congestion", "high-mid harshness"). Demucs is disabled (`USE_DEMUCS = False`, line 27). User stems only add an extra `result["stems"]` block via `_analyze_user_stems` (lines 52–53, 73–115).
- **Phase 5 (reference delta)** — `phases/phase5_reference.py`. `compare()` computes LUFS/RMS/stereo/per-band deltas between the **uploaded mix and the reference mix** (lines 150–182). Per-stem reference deltas are attached only `_attach_stem_reference_deltas` (lines 194–248) and degrade gracefully to `"unavailable"`/`"skipped"` when stems are absent.

**So the 7-phase report is complete and correct with zero stems.** This is confirmed by `input_grounding.py` in the worker (`components/worker/app/verdict_lib/input_grounding.py`), whose entire job is to tell specialists "no separated stems were provided — do NOT discuss individual stems" (lines 59–71). Mix-only is already a first-class, supported state.

### 1.2 Where roles actually matter

Roles feed exactly four things, and only one of them is real "math":

| Consumer | Code | Uses role for | Hard dependency on correct role? |
|---|---|---|---|
| **Balance flags** | `stems/analyzer.py` `_balance_flags` (152–168) | Look up genre RMS range `stem_rms_db_expectations[role]` | Yes — but **inert in prod** (see below) |
| **Stereo-width specialist** | `prompts/experts/StemStereoWidth.md` | Role → expected width (kick/bass = mono, pad/lead = wide) | Soft — wrong role → wrong expectation |
| **Reference-delta matching** | `stems/reference_comparator.py` `compare` (48–63) | Match user stem to **same-role** reference stem | Yes — role mismatch → no comparison |
| **Clash matrix + fixes** | `stems/analyzer.py` `_build_clash_*`; `StemBalance.md` | Human-readable labels `stem_a`/`stem_b`, `fix.target_stem` | No — labeling/attribution only |

**The balance-flag path is currently dead.** `_balance_flags` returns `[]` when `genre_profile is None` (analyzer.py:156–157), and phase 4 calls `analyze_grouped(groups)` with **no genre profile** (phase4_stems.py:90). So the StemBalance specialist — the most role-dependent analysis — **never fires in the v2 pipeline today.** The three stem specialists (`StemBalance`, `StemStereoWidth`, `StemReferenceDelta`) are otherwise pure translators of measured numbers into prescriptive sentences; the role label is mostly there to *name the channel* in the advice ("Reduce the bass channel by 4 dB").

**Quantified verdict:** if roles were unknown, you lose (a) per-role stereo-width expectations, (b) per-role reference matching, and (c) the ability to say *which* channel to adjust. You lose **nothing** in the mix-level report (phases 1–9), and you lose a balance check that isn't running anyway. Roles are ~80% attribution/labeling, ~20% threshold lookup.

### 1.3 The role taxonomy can't represent real sessions

`stems/types.py` `StemRole` (lines 8–18) = `drums, kick, snare, hats, bass, vocals, lead, pad, fx, other`. There is **no `keys`/`synth`/`piano`/`guitar` bucket.** The diagnostic session (below) is built almost entirely from synths (TRITON, Polysix, MS-20, MonoPoly, ARP Odyssey) — none of which have a correct label available. Even a perfect classifier would be forced to mislabel them as `lead`/`pad`/`other`.

---

## 2. Real-file diagnosis — `~/Music/23_4`

31 FLAC files: ~28 instrument/utility tracks + 2 buses + FX returns + the master mix `23_4.flac`, all 510.6 s long.

### 2.1 Current classifier output vs. reality

Ran `python -m audio_analysis.stems.classify "~/Music/23_4"`:

| File (reality) | Detected | Correct? | Note |
|---|---|---|---|
| 14-MonoPoly *(synth)* | kick | ✗ | no synth role exists; low-band → "kick" |
| 15-TRITON *(synth)* | snare | ✗ | |
| 16-Polysix *(synth)* | vocals | ✗ | "mid-band harmonic" → vocals (no vocals in track) |
| 17-Group *(BUS)* | vocals | ✗ | **duplicate of 18-ARP (see 2.2)** |
| 18-ARP_ODYSSEY *(synth)* | vocals | ✗ | |
| 19/22-TRITON | vocals | ✗ | |
| 20/27-TRITON, 29-MS-20 | other | ~ | correctly flagged near-silent (empty tracks) |
| 23-TRITON | drums | ✗ | |
| 24/26-TRITON | kick | ✗ | |
| 28-TRITON | snare | ✗ | |
| A-Reverb *(FX return)* | vocals | ✗ | **reverb tails of other tracks** |
| B-Delay *(FX return)* | snare | ✗ | **delay repeats of other tracks** |
| Sidechain *(trigger/utility)* | bass | ✗ | **loudest non-master track; not real content** |
| Bass / Kick / Snare / Clap / Crash / Hat / Hat-1 / C Hat / Drums / string_pad | (filename match) | ✓ | only the cleanly-named drum/bass/pad tracks land right — via filename, not audio |
| misc | hats | ~ | |
| Tamb *(tambourine)* | drums | ~ | reasonable; ideally hats/perc |
| **23_4.flac** *(the MASTER MIX)* | **bass** | ✗ | **the full mix got swept in and classified as a stem** |

**Score: roughly 9/31 acceptable, and every one of those came from the filename keyword path, not the spectral classifier.** Every synth was mislabeled; the spectral fallback is effectively random for melodic/synth content.

### 2.2 Why it fails — it's the *export*, not (only) the algorithm

This is a **raw session multitrack** ("export every track"), not an analysis-ready stem bundle. Numeric proof (`soundfile`/`numpy`):

- **Bus duplication:** `corr(17-Group, 18-ARP_ODYSSEY) = 1.0000` — the "Group" track is a bit-identical copy of the ARP synth. `corr(Drums bus, sum of individual Kick+Clap+Hats+Crash+Tamb) = 0.77` at near-equal RMS — the Drums bus re-contains the individual drum tracks. **Summing by role double-counts everything that also feeds a bus.**
- **FX returns carry no independent source:** `corr(A-Reverb, mix) = −0.01`, `corr(B-Delay, mix) = −0.02` — they're reverb/delay tails of *other* tracks, not instruments. Summing them adds phantom energy and pollutes any role bus they're forced into.
- **Utility track:** `Sidechain.flac` is the **loudest non-master track (−13.8 dB)**, weakly correlated to the kick (0.27) — a sidechain trigger/ghost track that isn't in the audible mix. It dominated the "bass" bus it was assigned to.
- **Dead tracks:** `Snare`, `Hat`, `string_pad`, `20/27-TRITON`, `29-MS-20` are digital silence (−99 dB) — unused channels exported anyway.
- **The decisive number:** naive sum of all 30 exported tracks gives **RMS 0.389 vs the mix's 0.149 = 2.62× too loud, at correlation −0.08 with the actual mix.** The export **does not reconstruct the mix.** Grouped-mode stem analysis (which sums each role's stems into a bus) is therefore operating on physically meaningless signals — its band energy, clash matrix, and balance numbers would all be wrong, *regardless of how good role classification is.*

### 2.3 What a *good* export for analysis looks like — and why we shouldn't ask for it

An analysis-ready stem bundle is a **small set of non-overlapping, full-length, summable buses that reconstruct the mix** — canonically `drums / bass / vocals / other` (MUSDB18 convention; see §3.3). The user's DAW export is the opposite: overlapping buses, FX returns, utility tracks, and duplicates. **Expecting non-engineers to hand-curate this is unrealistic** — it's exactly the burden the product owner wants to remove. Even with perfect instructions, "export stems" is error-prone and high-friction.

Practical implication: if we keep accepting user stems at all, we **must** defend against this input — detect & drop FX returns (low/zero correlation to mix; names like `*reverb*`,`*delay*`,`*return*`,`*fx*`), bus/duplicate tracks (a track ≈ sum of others; `*group*`,`*bus*`,`*mix*`,`*master*`), utility tracks (`*sidechain*`,`*trigger*`,`*ghost*`), silent tracks, and the master file itself. **But the cleaner answer is to not require stems at all.**

---

## 3. Better approaches (current SOTA, cited)

### 3.1 Source separation — upload the mix, derive stems automatically

This removes both the export burden and the labeling burden: separated sources come **pre-labeled** by the model (the "drums" output *is* the drums role — no classifier needed).

| Model | Stems | SDR (vocals, MUSDB18-HQ) | License | ~5-min CPU | ~5-min GPU | Request-time CPU? |
|---|---|---|---|---|---|---|
| **htdemucs** (Demucs v4) | 4 | 9.2 dB | MIT (code+weights) | ~2.5–8 min | ~10–30 s | Marginal |
| htdemucs_ft | 4 | ≥htdemucs | MIT | 10–30+ min (4×) | ~40–120 s | No |
| **htdemucs_6s** | **6 (+guitar,+piano)** | n/a | MIT | similar | ~10–30 s | Marginal |
| **Spleeter** | 2/4/5 (+piano) | ~6.55 dB | **MIT** | fast (~100× RT on GPU) | <1 s/100 s audio | **Yes — fastest** |
| **open-unmix umxhq** | 4 | 6.25 dB | **MIT code + commercial weights** | CPU-viable (light BiLSTM) | fast | **Yes (light)** |
| open-unmix umxl | 4 | 7.21 dB | code MIT; **weights CC BY-NC-SA (non-commercial)** | CPU-viable | fast | Yes but non-commercial |
| BS-/Mel-Band RoFormer | 4 | **11.6–12.7 dB** | code MIT; **official weights unreleased; community weights = vet terms** | impractical | GPU (≥8–40 GB) | No |
| MDX-Net / UVR | 4 | ~9 dB | open (ONNX) | slow | GPU | No |

Sources: Demucs README + paper (RTF 2.04/core; `_ft` = 4× slower), benchmarks (187.8 s for 6:24 on 6-core i5-12400F; 15.6 s on RTX 3060 Ti) — github.com/facebookresearch/demucs, ar5iv.labs.arxiv.org/html/2211.08553, aistemsplitter.org/blog/htdemucs-vs-bs-roformer-vs-spleeter-2026-benchmark. Spleeter — github.com/deezer/spleeter, joss.theoj.org/papers/10.21105/joss.02154. open-unmix — sigsep.github.io/open-unmix. RoFormer weights/licensing — github.com/lucidrains/BS-RoFormer, github.com/ZFTurbo/Music-Source-Separation-Training.

**Key insight for SPECTR:** analysis tolerates *much* lower fidelity than remixing. We don't need 12 dB SDR vocals — we need roughly-correct per-stem band energy, loudness, width and clash. **Spleeter (MIT, ~100× realtime) or open-unmix umxhq (MIT, commercial-safe) are good enough for analysis and fast enough for a synchronous CPU worker.** This mirrors the existing `USE_DEMUCS=False` performance gate — but instead of *disabling* separation, swap in a model that's actually fast.

**GPU cost for an opt-in high-fidelity path** (htdemucs, ~35–60 s GPU): Replicate prebuilt demucs ≈ **$0.04/track**; raw T4/L4 on Modal/RunPod ≈ **$0.01–0.014/track** (Demucs fits in 16–24 GB; keep `concurrency=1` for the ~7 GB footprint). Managed APIs (LALAL.AI ~$0.60–1.00/5-min track; AudioShake/Moises sales-gated) are 15–50× pricier but zero-ops and higher fidelity. Sources: replicate.com/pricing, modal.com/pricing, runpod.io/pricing, lalal.ai/pricing.

### 3.2 Content-based role classification (if we still ingest user stems)

If user-supplied stems stay as a power-user option, replace the spectral heuristic with **a frozen audio-tagging embedding + a small trained linear/MLP probe** — the validated pattern (not zero-shot, not end-to-end).

| Backbone | OpenMIC mAP | Params | CPU | License |
|---|---|---|---|---|
| **PANNs CNN14** | **0.853** | 81M | Yes (CNN) | **Apache-2.0** |
| YAMNet | (smaller/coarser) | ~3.7M | **Yes — fastest, TFLite** | Apache-2.0 |
| OpenL3 / torchopenl3 | 0.803 | ~4.7M | Yes | MIT |
| PaSST | 0.858 | 87M | moderate | Apache-2.0 |
| BEATs | **0.870** | ~90M | heavy | MIT |
| CLAP (zero-shot) | NSynth-instr 48–58% | — | Yes | Apache-2.0/MIT |

Sources: arxiv 2306.17424 (OpenMIC frozen-embedding table), arxiv 2312.14005 (BEATs 0.870), github.com/qiuqiangkong/audioset_tagging_cnn (PANNs, Apache-2.0), arxiv 2309.05767 + 2503.22104 (CLAP zero-shot instrument ≈48–58%).

Findings: **PANNs CNN14 + linear probe is the best accuracy-per-CPU-dollar with a clean commercial license** (0.853 mAP, ~5 mAP above OpenL3, within 0.02 of the transformer ceiling). **Zero-shot CLAP text prompts ("a kick drum") do NOT reliably classify instruments** (48–58% on NSynth-instrument; no evidence for kick/snare/hat) — use CLAP/PANNs as a *frozen feature under a trained probe*, never as zero-shot prompts. **MERT/MULE/Jukebox are non-commercial — avoid for a paid product.** Drum sub-roles (kick/snare/hat) are a *separate* supervised problem (ADT; ADTLib/Omnizart on CPU, F≈0.88 on full mixes). Sources: MARBLE arxiv 2306.10548, arxiv 1806.06676 + 2509.21739 (ADT).

### 3.3 Taxonomy fix

No MUSDB18-derived system has a standalone "synth" class. The defensible small role set is **vocals / drums / bass / keys / other**, where **keys** absorbs piano + synth lead + pad + organ (MoisesDB functional grouping, ISMIR 2023), synth-bass → bass, drum-machine → drums. Adopting this (a) matches what separation models output for free and (b) gives the user's TRITON/Polysix/MS-20 tracks a correct home. Source: MoisesDB (archives.ismir.net/ismir2023/paper/000073.pdf), MUSDB18 (sigsep.github.io/datasets/musdb.html).

---

## 4. Answers to the core questions

1. **Is the stem process required for the best analysis?** No. The mix-only report (phases 1–9, including phase-4 clash and phase-5 reference deltas) is complete on its own; stems are an enrichment, and the one role-dependent threshold check (balance flags) is inert today. Stems add per-stem balance/width/reference attribution — a fidelity boost, not a foundation. **Auto-separation recovers most of that boost without any user effort.**

2. **Can we eliminate user role-labeling entirely?** Yes — two independent ways: (a) **source separation labels stems by construction** (the "drums" output is the drums role); (b) if we still accept user stems, a **PANNs-embedding probe** replaces the filename/spectral heuristic. Either way the manual confirm step disappears (or becomes a one-tap override).

3. **Recommended target architecture + migration:**
   - **Default path — mix-only.** User uploads only the mix. Run phases 1–9 as today. This is already supported end-to-end (`input_grounding` proves it). *Make this the headline path; drop stems from the required flow.*
   - **Optional fidelity boost — auto-separation.** Offer "deeper per-stem analysis" that runs **Spleeter/umxhq at request-time (CPU)** for analysis-grade stems, feeding the existing `analyze_grouped` path with **model-labeled roles** (no classifier, no confirm). Offer **htdemucs on a GPU/serverless worker** for an opt-in "listenable stems" export.
   - **Power-user path — user stems (hardened).** Keep accepting uploaded stems, but (i) auto-derive roles via PANNs probe, (ii) **run the bus/FX/duplicate/silence guard from §2.2** and exclude non-source tracks before summing, (iii) widen the taxonomy to include `keys`.

   **Migration sketch from today's stage→classify→confirm:**
   1. *Now (no code change):* nothing required — mix-only already works; document it as the supported default.
   2. *Phase A:* add a `separate_mix` worker actor (Spleeter/umxhq) and a "deep stem analysis" toggle on the mix-only upload; feed its outputs to `analyze_grouped`. Remove the **confirm** step on this path (roles come from the model). Widen `StemRole` to add `keys`.
   3. *Phase B:* replace `role_detector._spectral_classify` with a PANNs-embedding probe for the *remaining* user-stem path; keep filename match as a fast prior. Add the input-quality guard (drop buses/FX/silence/master).
   4. *Phase C:* add a GPU/serverless htdemucs path behind a premium "export stems" feature. Re-evaluate whether the manual stem-upload flow is still worth maintaining; likely deprecate stage/classify/confirm in favor of auto-separation + optional override.

   **Trade-offs:** auto-separation adds CPU/GPU cost and latency (seconds for Spleeter, minutes for Demucs-CPU) and is imperfect (6–9 dB SDR) — acceptable for analysis, not for mastering. It removes ~all user friction and the entire mislabeling failure mode. User-supplied clean stems remain the highest-fidelity option for power users who export correctly.

---

## Appendix — commands & evidence

- Classifier run: `python -m audio_analysis.stems.classify "~/Music/23_4"` (output in §2.1).
- Numeric proofs (soundfile/numpy): `corr(17-Group,18-ARP)=1.0000`; `corr(Drums bus, Σ drum tracks)=0.77`; `corr(A-Reverb,mix)=−0.01`, `corr(B-Delay,mix)=−0.02`; `corr(Sidechain,Kick)=0.27`; Σ-all-tracks RMS 0.389 vs mix 0.149 = **2.62×**, corr **−0.08**.
- Key code: `phases/phase4_stems.py` (mix-only spectral active; `USE_DEMUCS=False`), `phases/phase5_reference.py` (mix-only deltas + optional per-stem), `stems/analyzer.py` (`_balance_flags` needs genre_profile, never passed), `stems/types.py` (`StemRole` — no keys/synth), `worker/app/verdict_lib/input_grounding.py` (mix-only is a supported state), `prompts/experts/Stem*.md` (roles = attribution).
