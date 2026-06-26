# Genre-corpus tuner

Replaces the `suspected` / `interpolation` placeholder thresholds in
`app/verdict_lib/config/genre-profiles.json` with values **measured from a corpus
of pro reference tracks**, per genre.

It measures each track through the **same phase1 DSP the rule engine reads**, so a
proposed threshold is directly comparable to what a rule sees in production — no
measurement drift.

## Layout of the corpus

```
<reference_dir>/
  modern_trance/   *.wav | *.flac | *.mp3 | *.aiff | *.m4a | *.ogg
  techno/          ...
  classic_trance/  ...
```

Each subfolder name is mapped to a profile key via `genre_config.resolve_genre`
(so `trance/` → `modern_trance`). Aim for **20–30 tracks per genre**; the tool warns
below `--min-tracks` (default 8).

## Run

```bash
# dry run — prints a report + proposed changes, writes nothing
python -m app.tools.genre_corpus data/reference_library --out output/worker/genre-corpus-report.json

# apply — patches genre-profiles.json (backs up to genre-profiles.json.bak)
python -m app.tools.genre_corpus data/reference_library --write
```

Needs the `audio_analysis` package installed (`pip install -e components/analysis`),
since it runs phase1 per track. `defer_structure=True` skips the slow allin1 step.

## What it tunes (measured → config)

| Config path | Source stat |
|---|---|
| `loudness.club.lufs_target` / `lufs_range` | median / p10–p90 of integrated LUFS |
| `loudness.club.true_peak_dbtp_max` | p90 true peak |
| `loudness.stability.short_term_over_integrated_lu` | p90 of (short-term max − integrated) |
| `dynamics.crest_db.target` / `range` / `warn_below` | median / p10–p90 / p10 crest |
| `dynamics.lra_lu.target` / `range` | median / p10–p90 LRA |
| `dynamics.plr.warn_below` | p10 of (true peak − LUFS) |
| `dynamics.transient_strength.weak_below` | p10 avg onset strength |
| `bpm.min` / `max` / `center` | p10 / p90 / median BPM |

Each gets `provenance: "measured"`. The qualitative `spectral_tilt` / `stereo`
hints are **reported, not auto-set** (their measured band/centroid/width stats are in
the report for a human to translate into `brightness_rank` etc.). `loudness.streaming`
(the −14 LUFS platform standard) is never touched.

## After applying

1. Review the diff in `genre-profiles.json` (and the `.bak`).
2. Flip the now-measured rules from `suspected=True` → `False` in
   `app/verdict_lib/rule_engine.py` (e.g. `weak_transients`, `unstable_loudness`,
   the tonal A7–A12 rules) where the threshold is now corpus-backed.
3. Re-run the worker tests + the clean-baseline guard.
