"""Authored static map of the analysis + verdict pipeline.

One entry per stage: a human narration (what it consumes / produces / how the
data is used) plus the datapoints it reads (`inputs`) and emits (`outputs`).
This is the backbone for catalog mode, per-stage narration, and static gap
detection (spec §6). It is *authored*, not introspected — phase outputs are
dynamic dicts with no typed schema — so `diff_against_final_json` (spec §6.1)
guards it against drift.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.verdict_lib.flatten_analysis import flatten


@dataclass(frozen=True)
class Stage:
    key: str
    title: str
    narration: str
    inputs: tuple[str, ...]
    outputs: tuple[str, ...]


STAGE_MAP: list[Stage] = [
    Stage(
        key="phase1",
        title="Phase 1 — Universal Mix Analysis",
        narration=(
            "Consumes the 44.1 kHz WAV. Produces loudness, true-peak, clipping, "
            "BPM, key, a 7-band spectrum, and stereo health. These are the raw "
            "measurements nearly every downstream rule and specialist reads."
        ),
        inputs=("wav",),
        outputs=(
            "phase1.lufs", "phase1.rms", "phase1.bpm", "phase1.duration_seconds",
            "phase1.bands", "phase1.stereo_correlation", "phase1.stereo_width",
            "phase1.true_peak_db", "phase1.peak_dbfs", "phase1.clipping_detected",
            "phase1.clipped_sample_count", "phase1.detected_key",
            "phase1.mono_compatibility", "phase1.low_energy", "phase1.structure",
        ),
    ),
    Stage(
        key="phase2",
        title="Phase 2 — Genre Detection",
        narration=(
            "Consumes Phase 1 BPM + presence band. Produces a genre label and "
            "confidence used to select genre-specific scoring and rules."
        ),
        inputs=("phase1.bpm", "phase1.bands"),
        outputs=("phase2.genre", "phase2.confidence", "phase2.bpm"),
    ),
    Stage(
        key="phase3",
        title="Phase 3 — Genre-Specific Scoring",
        narration=(
            "Consumes Phase 1 metrics + the Phase 2 genre. Produces a 0–100 "
            "genre score and sub-scores that become the overall grade."
        ),
        inputs=("phase1.bands", "phase1.stereo_width", "phase1.bpm", "phase2.genre"),
        outputs=("phase3.genre", "phase3.total_score", "phase3.sub_scores", "phase3.notes"),
    ),
    Stage(
        key="phase4",
        title="Phase 4 — Stem Separation & Clash",
        narration=(
            "Consumes the WAV (and optional user stems). Produces per-band energy "
            "and frequency-clash findings (low-end buildup, mud, harshness)."
        ),
        inputs=("wav", "stem_paths"),
        outputs=("phase4.stems", "phase4.band_energy", "phase4.clashes"),
    ),
    Stage(
        key="phase5",
        title="Phase 5 — Reference Comparison",
        narration=(
            "Consumes the WAV plus an optional reference track and the genre. "
            "Produces feature deltas vs the reference and vs genre targets. "
            "Skipped (status only) when no reference is supplied."
        ),
        inputs=("wav", "reference_wav", "phase1.lufs", "phase2.genre"),
        outputs=("phase5.status", "phase5.deltas", "phase5.genre_context"),
    ),
    Stage(
        key="phase6",
        title="Phase 6 — Gap Analysis",
        narration=(
            "Consumes Phase 1 metrics + a statistical genre profile. Produces a "
            "percentile ranking and per-feature gaps vs the genre library."
        ),
        inputs=("phase1.bpm", "phase1.stereo_correlation", "phase2.genre"),
        outputs=("phase6.genre", "phase6.percentile", "phase6.gaps"),
    ),
    Stage(
        key="phase7",
        title="Phase 7 — Arrangement Advice",
        narration=(
            "Consumes the Phase 1 song structure + genre/BPM/duration. Produces "
            "an arrangement score, section scores, and suggestions."
        ),
        inputs=("phase1.structure", "phase2.genre", "phase1.bpm", "phase1.duration_seconds"),
        outputs=(
            "phase7.overall_score", "phase7.grade", "phase7.component_scores",
            "phase7.section_scores", "phase7.suggestions", "phase7.fixes",
            "phase7.violations", "phase7.section_count",
        ),
    ),
    Stage(
        key="phase8",
        title="Phase 8 — ALS Analysis (optional)",
        narration=(
            "Consumes an Ableton .als project when uploaded. Produces project "
            "health, device/track summaries, and MIDI findings. Absent otherwise."
        ),
        inputs=("als_file",),
        outputs=("phase8.health_score", "phase8.tracks", "phase8.midi", "phase8.arrangement"),
    ),
    Stage(
        key="phase9",
        title="Phase 9 — Mix Translation",
        narration=(
            "Consumes the WAV. Produces spatial / surround / playback translation "
            "scores (mono collapse, headphone vs speaker) feeding the coach."
        ),
        inputs=("wav",),
        outputs=("phase9.spatial", "phase9.surround", "phase9.playback"),
    ),
    Stage(
        key="rollups",
        title="Rollups — score, grade, coach",
        narration=(
            "Consumes Phase 3 (score/grade), Phase 7/4/9 (fixes), and Phase 1/9 "
            "(coach triggers). Produces the top-level summary fields the report "
            "header and coach panel render."
        ),
        inputs=("phase3.total_score", "phase7.suggestions", "phase4.clashes", "phase9.surround"),
        outputs=(
            "overall_score", "grade", "top_fixes", "danceability_score",
            "coach_name", "coach_intro", "coached_fixes",
        ),
    ),
    Stage(
        key="rule_engine",
        title="Rule engine (deterministic)",
        narration=(
            "Consumes the flattened final_json. Produces baseline verdicts for "
            "hard, objective violations (clipping, true-peak, mono) with no LLM. "
            "Runs before and independently of triage."
        ),
        inputs=("flattened_final_json",),
        outputs=("rule_verdicts",),
    ),
    Stage(
        key="triage",
        title="Triage (LLM routing)",
        narration=(
            "Consumes the flattened final_json + rule verdicts. Produces a routing "
            "plan (which specialists to run, skip list, rationale). This is an LLM "
            "call — shown from persisted routing_plan, never re-run here."
        ),
        inputs=("flattened_final_json", "rule_verdicts"),
        outputs=("routing_plan.specialists_to_run", "routing_plan.skip", "routing_plan.rationale"),
    ),
    Stage(
        key="specialists",
        title="Specialists (LLM)",
        narration=(
            "Each selected specialist consumes the analysis + a focus note and "
            "produces verdicts (headline, evidence, fix). LLM calls — shown from "
            "persisted verdict rows, never re-run here."
        ),
        inputs=("flattened_final_json", "routing_plan.specialists_to_run"),
        outputs=("specialist_verdicts",),
    ),
    Stage(
        key="validation",
        title="Validation + scoring (deterministic)",
        narration=(
            "Consumes each verdict + the analysis. Produces a validated verdict: "
            "metric paths checked, section/ALS sanity, and a moderate-baseline "
            "severity downgrade with priority_score recomputed in Python."
        ),
        inputs=("specialist_verdicts", "flattened_final_json"),
        outputs=("validated_verdicts",),
    ),
    Stage(
        key="ranking",
        title="Dedupe + rank",
        narration=(
            "Consumes all validated verdicts. Produces the deduped, "
            "priority-sorted final list surfaced to the UI."
        ),
        inputs=("validated_verdicts",),
        outputs=("ranked_verdicts",),
    ),
]


def declared_output_paths() -> set[str]:
    return {p for s in STAGE_MAP for p in s.outputs}


def stage_for_path(path: str) -> str | None:
    for s in STAGE_MAP:
        if path in s.outputs:
            return s.key
    return None


def _actual_paths(final_json: dict) -> tuple[set[str], set[str]]:
    """Return (actual_paths, present_phase_keys) from a real final_json."""
    flat = flatten(final_json)
    actual: set[str] = set()
    present_phases: set[str] = set()
    for k, v in flat.items():
        if k.startswith("phase") and isinstance(v, dict):
            present_phases.add(k)
            for fk in v:
                actual.add(f"{k}.{fk}")
        elif not k.startswith("phase"):
            actual.add(k)
    return actual, present_phases


def diff_against_final_json(final_json: dict) -> tuple[list[str], list[str]]:
    declared = declared_output_paths()
    actual, present_phases = _actual_paths(final_json)
    stale_missing = sorted(a for a in actual if a not in declared)
    phantom: list[str] = []
    for d in sorted(declared):
        if d in actual:
            continue
        phase = d.split(".")[0] if "." in d and d.startswith("phase") else None
        # Only flag a declared path as phantom when its phase is present in the
        # snapshot (skipped optional phases must not false-flag), or when it is
        # a top-level rollup key (always expected).
        if phase is None or phase in present_phases:
            phantom.append(d)
    return stale_missing, phantom
