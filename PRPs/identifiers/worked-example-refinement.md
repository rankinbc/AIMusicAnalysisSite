# Composite refinement — worked before/after

Shows the Composite Refiner turning two coarse-but-certain composites into
specific, localized, genre-judged records. The composite supplies the certainty;
the LLM + genre config + time-series supply the precision.

---

## C1 — loudness_war

### IN: the fired composite (coarse, certain)

```json
{
  "problem_id": "dynamics.loudness_war.0",
  "severity": "severe", "confidence": 0.95, "suspected": false,
  "headline": "Over-limited master — dynamics crushed and peaks clipped",
  "summary": "Crest, LRA, and true peak all indicate aggressive limiting.",
  "evidence": [
    { "metric": "phase1.crest_factor", "value": 4.8, "expected_range": [7,12], "label": "crushed dynamics" },
    { "metric": "phase1.loudness_range_lu", "value": 2.9, "expected_range": [5,9], "label": "low LRA" },
    { "metric": "phase1.true_peak_db", "value": -0.1, "expected_range": [-1.5,-1.0], "label": "against the ceiling" }
  ],
  "where": { "section_type": null, "start_seconds": 0, "end_seconds": 0 },
  "data_tier": "audio_only"
}
```

Genre = `classic_trance`. Refiner is handed this + the genre config + the
short-term loudness series + per-section RMS.

### OUT: refined, split into two children

The refiner finds the composite was two problems: transient-crushing concentrated
in the drops, *and* a true-peak ceiling issue — judged hard because classic trance
should be DR 9–12, not 4.8.

```json
{
  "specialist": "composite_refiner",
  "problems": [
    {
      "problem_id": "dynamics.crushed_drops.0",
      "refines": "dynamics.loudness_war.0",
      "category": "dynamics", "source": "llm_identifier",
      "severity": "severe", "confidence": 0.9, "suspected": false,
      "headline": "Limiting crushes the drop transients; breakdown untouched",
      "summary": "Short-term loudness flattens to ~2 LU variation across both drops while the breakdown retains range. The kick attack is being limited away. At crest 4.8 the master is far below the DR 9–12 expected for classic trance.",
      "evidence": [
        { "metric": "phase1.crest_factor", "value": 4.8, "expected_range": [9,12], "label": "crest vs classic-trance ideal", "frequency_range_hz": null, "stems": null },
        { "metric": "loudness.short_term_series", "value": 2.1, "expected_range": [5,9], "label": "ST range across drops", "frequency_range_hz": null, "stems": null }
      ],
      "where": { "section_type": "drop", "start_seconds": 88, "end_seconds": 152 },
      "data_tier": "audio_only", "fixable": true, "fix": null
    },
    {
      "problem_id": "clipping.ceiling_pinned.0",
      "refines": "dynamics.loudness_war.0",
      "category": "clipping", "source": "llm_identifier",
      "severity": "moderate", "confidence": 0.95, "suspected": false,
      "headline": "True peak pinned at -0.1 dBTP — no codec headroom",
      "summary": "Master sits at -0.1 dBTP. For a streaming deliverable this risks lossy-codec distortion; classic-trance streaming target is -14 LUFS at -1.0 dBTP.",
      "evidence": [
        { "metric": "phase1.true_peak_db", "value": -0.1, "expected_range": [-1.5,-1.0], "label": "ceiling vs -1 dBTP std", "frequency_range_hz": null, "stems": null }
      ],
      "where": { "section_type": null, "start_seconds": 0, "end_seconds": 0 },
      "data_tier": "audio_only", "fixable": true, "fix": null
    }
  ]
}
```

What got sharper: a single "over-limited" became a **localized** transient problem
(scoped to 88–152 s, the drops) the solver can treat with section-specific
dynamics, plus a **separate** ceiling problem. Severity on the first is justified
*by the genre target*, not a generic threshold — the config is doing the work.

---

## C4 — untreated_low_end (routing composite)

### IN: the fired composite

```json
{
  "problem_id": "low_end.untreated_low_end.0",
  "severity": "severe", "confidence": 0.9, "suspected": false,
  "headline": "Dense low end with no ducking signature",
  "summary": "Sub/bass bands hot, missing-sidechain signature present, low_energy high.",
  "evidence": [
    { "metric": "phase1.bands.bass", "value": -3.2, "expected_range": [-9,-6], "label": "bass hot" },
    { "metric": "phase1.low_energy", "value": 0.61, "expected_range": [0.3,0.45], "label": "LF energy high" }
  ],
  "where": null,
  "data_tier": "audio_only"
}
```

Genre = `modern_trance`. Stems are present this time, so the refiner can name
elements. Series available: momentary loudness + per-section RMS.

### OUT: refined in place (one problem, now specific)

```json
{
  "specialist": "composite_refiner",
  "problems": [
    {
      "problem_id": "low_end.untreated_low_end.0",
      "refines": "low_end.untreated_low_end.0",
      "category": "low_end", "source": "llm_identifier",
      "severity": "severe", "confidence": 0.92, "suspected": false,
      "headline": "Kick and bass collide at 55–70 Hz through the drop — no ducking",
      "summary": "Kick and bass stems overlap at 55–70 Hz; momentary low-band loudness never dips on kick hits, so the bass isn't ducking. Worst in the main drop (1:28–2:50); breakdown is clean. A modern-trance club master at -6 LUFS can't carry this much overlap.",
      "evidence": [
        { "metric": "phase4.stems.clash_matrix.0.overlap_severity", "value": 0.78, "expected_range": [0,0.3], "label": "kick/bass clash, bass band", "frequency_range_hz": [55,70], "stems": ["Kick","Bass"] },
        { "metric": "loudness.momentary_series", "value": 0.0, "expected_range": [3,6], "label": "no LF dip on kick (duck depth)", "frequency_range_hz": [55,70], "stems": null }
      ],
      "where": { "section_type": "drop", "start_seconds": 88, "end_seconds": 170 },
      "data_tier": "stems", "fixable": true, "fix": null
    }
  ]
}
```

What got sharper: "dense low end" became **named stems** (Kick/Bass), an **exact
band** (55–70 Hz), a **scoped section** (the drop), and a **genre-justified**
urgency (a −6 LUFS club master can't afford the overlap). And the `data_tier`
upgraded to `stems` because the refiner used the clash matrix — so the router now
sends this to the **Sidechain Specialist** with everything it needs to name both
stems and scope the duck to the drop.

---

## Why this is the (1b) payoff

In both cases the deterministic composite did the certain-but-blunt detection for
free, and the LLM spent its budget only on a confirmed problem — turning it into
something the solver can act on precisely. The genre config is what made "how bad"
genre-correct instead of generic, and the Tier B time-series is what made "where"
real instead of guessed. Without the lifts, the refiner could only restate the
composite; with them, it localizes. Same investment, both payoffs.
