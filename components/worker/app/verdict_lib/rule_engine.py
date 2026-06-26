from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Callable

from aimusic_shared.verdicts.models import (
    DataTier,
    Evidence,
    ProblemKind,
    ProblemSource,
    Severity,
    Verdict,
)
from aimusic_shared.verdicts.scoring import compute_priority_score
from aimusic_shared.verdicts.ulid_helpers import new_verdict_id

from app.verdict_lib.suppression import apply as _apply_suppression

RULE_ENGINE_VERSION = "rule_engine@1.0.0"
RULE_MODEL = "rules"

RuleFn = Callable[[dict[str, Any]], "Verdict | None"]
_RULES: list[RuleFn] = []


def rule(fn: RuleFn) -> RuleFn:
    """Decorator to register a rule function."""
    _RULES.append(fn)
    return fn


def evaluate_rules(analysis: dict[str, Any]) -> list[Verdict]:
    """Run every registered rule. Each rule returns a Verdict or None."""
    out: list[Verdict] = []
    for fn in _RULES:
        v = fn(analysis)
        if v is not None:
            out.append(v)
    return out


def _make(
    *,
    track_id: str,
    severity: Severity,
    category: str,
    headline: str,
    summary: str,
    evidence: list[Evidence],
    why_it_matters: str,
    scope: str = "full_track",
    confidence: float = 1.0,
) -> Verdict:
    score = compute_priority_score(severity, category, scope)  # type: ignore[arg-type]
    return Verdict(
        verdict_id=new_verdict_id(),
        track_id=track_id,
        specialist="rule_engine",
        prompt_version=RULE_ENGINE_VERSION,
        model=RULE_MODEL,
        severity=severity,
        category=category,  # type: ignore[arg-type]
        confidence=confidence,
        priority_score=score,
        headline=headline,
        summary=summary,
        evidence=evidence,
        fix=None,
        why_it_matters=why_it_matters,
        related_verdict_ids=[],
        sources=["rule_engine"],
        created_at=datetime.now(tz=timezone.utc),
    )


def _track_id(analysis: dict[str, Any]) -> str:
    return analysis.get("track_id", "unknown-track")


def _phase(analysis: dict[str, Any], key: str) -> dict[str, Any]:
    return analysis.get(key) or {}


# ── Two-pass Problem engine (singles → composites + suppression) ─────────────
# New tiered harness. Runs alongside the legacy `rule`/`evaluate_rules` path
# above until the reconcile step retires it. Rules emit the richer Problem shape
# (problem_id/kind/data_tier/…) via `_problem`.

SingleFn = Callable[[dict[str, Any]], "Verdict | None"]
CompositeFn = Callable[[dict[str, Any], dict[str, "Verdict"]], "Verdict | None"]
_SINGLES: list[tuple[str, SingleFn]] = []
_COMPOSITES: list[tuple[str, list[str], CompositeFn]] = []


def single(slug: str, tier: str = "A") -> Callable[[SingleFn], SingleFn]:
    """Register a single-metric rule (Tier A / B / S / P)."""
    def deco(fn: SingleFn) -> SingleFn:
        _SINGLES.append((slug, fn))
        return fn
    return deco


def composite(slug: str, suppresses: list[str]) -> Callable[[CompositeFn], CompositeFn]:
    """Register a Tier-C composite that absorbs the listed child slugs when it fires."""
    def deco(fn: CompositeFn) -> CompositeFn:
        _COMPOSITES.append((slug, suppresses, fn))
        return fn
    return deco


def _problem(
    *,
    track_id: str,
    slug: str,
    severity: Severity,
    category: str,
    headline: str,
    summary: str,
    evidence: list[Evidence],
    why_it_matters: str,
    index: int = 0,
    scope: str = "full_track",
    confidence: float = 0.9,
    kind: ProblemKind = "fault",
    source: ProblemSource = "rule_engine",
    data_tier: DataTier = "audio_only",
    fixable: bool = True,
    suspected: bool = False,
    where: dict[str, Any] | None = None,
) -> Verdict:
    """Build a Problem record (a Verdict with the IDENTIFY-tier fields populated)."""
    score = compute_priority_score(severity, category, scope)  # type: ignore[arg-type]
    return Verdict(
        verdict_id=new_verdict_id(),
        track_id=track_id,
        specialist=f"rule_engine.{slug}",
        prompt_version=RULE_ENGINE_VERSION,
        model=RULE_MODEL,
        severity=severity,
        category=category,  # type: ignore[arg-type]
        confidence=confidence,
        priority_score=score,
        headline=headline,
        summary=summary,
        evidence=evidence,
        fix=None,
        why_it_matters=why_it_matters,
        related_verdict_ids=[],
        sources=["rule_engine"],
        created_at=datetime.now(tz=timezone.utc),
        problem_id=f"{category}.{slug}.{index}",
        kind=kind,
        source=source,
        data_tier=data_tier,
        fixable=fixable,
        suspected=suspected,
        where=where,
    )


def _tiered(value: float, bands: dict[str, float], *, higher_is_worse: bool) -> Severity | None:
    """Pick the hottest severity whose threshold *value* crosses. `bands` keys are
    severity names; only the present ones are checked, worst-first."""
    for sev in ("critical", "severe", "moderate", "minor"):
        if sev in bands:
            thr = bands[sev]
            if (higher_is_worse and value > thr) or (not higher_is_worse and value < thr):
                return sev  # type: ignore[return-value]
    return None


def evaluate_problems(
    analysis: dict[str, Any],
    *,
    singles: list[tuple[str, SingleFn]] | None = None,
    composites: list[tuple[str, list[str], CompositeFn]] | None = None,
) -> list[Verdict]:
    """Two-pass evaluation: run all singles, then composites, then apply
    suppression. Registries default to the module globals; pass explicit ones
    in tests to avoid touching the global set."""
    singles = _SINGLES if singles is None else singles
    composites = _COMPOSITES if composites is None else composites
    fired: dict[str, Verdict] = {}
    for slug, fn in singles:
        v = fn(analysis)
        if v is not None:
            fired[slug] = v
    hits = []
    for slug, suppresses, cfn in composites:
        cv = cfn(analysis, fired)
        if cv is not None:
            hits.append((slug, suppresses, cv))
    return _apply_suppression(fired, hits)


# ── Rules ──────────────────────────────────────────────────────────────────


@rule
def clipping_detected(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    if not p1.get("clipping_detected"):
        return None
    n = int(p1.get("clipped_sample_count", 0))
    return _make(
        track_id=_track_id(analysis),
        severity="critical",
        category="clipping",
        headline=f"Hard clipping detected ({n} samples)",
        summary="The signal is hitting digital ceiling. Distortion is audible "
                "and unfixable downstream.",
        evidence=[Evidence(
            metric="phase1.clipped_sample_count",
            value=float(n),
            label=f"{n} clipped samples",
        )],
        why_it_matters="Clipping is irreversible distortion. Mastering and "
                       "limiting downstream cannot remove it.",
    )


@rule
def true_peak_over_minus_1(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    tp = p1.get("true_peak_db")
    if tp is None or tp <= -1.0:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="severe",
        category="loudness",
        headline=f"True peak {tp:+.2f} dBTP — exceeds streaming limits",
        summary=f"Peak is {tp:+.2f} dBTP. Streaming services re-encode and "
                "introduce inter-sample peaks; aim for ≤ -1.0 dBTP.",
        evidence=[Evidence(
            metric="phase1.true_peak_db",
            value=float(tp),
            expected_range=(-6.0, -1.0),
            label=f"{tp:+.2f} dBTP",
        )],
        why_it_matters="Codec re-encoding (AAC, Opus) raises peaks. Any track "
                       "above -1.0 dBTP risks audible inter-sample distortion "
                       "on Spotify, YouTube, Apple Music.",
    )


@rule
def mono_incompatible(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    mono = p1.get("mono_compatibility")
    if mono is None or mono >= 0.7:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="severe",
        category="mono_compatibility",
        headline=f"Mono compatibility low ({mono:.2f})",
        summary=f"Mono fold-down RMS ratio is {mono:.2f}. Phase cancellation "
                "in stereo content is collapsing parts of the mix in mono.",
        evidence=[Evidence(
            metric="phase1.mono_compatibility",
            value=float(mono),
            expected_range=(0.7, 1.0),
            label=f"{mono:.2f} ratio",
        )],
        why_it_matters="Club systems, AM radio, single-speaker phones, and "
                       "Bluetooth earbuds can collapse a mix to mono. Parts "
                       "that disappear there sound thin and broken.",
    )


@rule
def loudness_too_high_for_streaming(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    lufs = p1.get("lufs")
    if lufs is None or lufs <= -8.0:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="moderate",
        category="loudness",
        headline=f"Master too loud for streaming ({lufs:.1f} LUFS)",
        summary=f"Integrated loudness is {lufs:.1f} LUFS. Spotify normalises to "
                "-14 LUFS; mastering hotter than -8 burns dynamics for no payoff.",
        evidence=[Evidence(
            metric="phase1.lufs",
            value=float(lufs),
            expected_range=(-16.0, -8.0),
            label=f"{lufs:.1f} LUFS",
        )],
        why_it_matters="Streaming services normalise loud masters down to "
                       "their target. A -7 LUFS master sounds the same volume "
                       "as a -14 LUFS master on Spotify, but the loud one has "
                       "less dynamic punch.",
    )


@rule
def loudness_too_low_for_streaming(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    lufs = p1.get("lufs")
    if lufs is None or lufs >= -20.0:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="moderate",
        category="loudness",
        headline=f"Master too quiet ({lufs:.1f} LUFS)",
        summary=f"Integrated loudness is {lufs:.1f} LUFS — Spotify will push "
                "the gain up but headroom and noise floor become problems.",
        evidence=[Evidence(
            metric="phase1.lufs",
            value=float(lufs),
            expected_range=(-20.0, -8.0),
            label=f"{lufs:.1f} LUFS",
        )],
        why_it_matters="Below -20 LUFS, streaming gain-up amplifies any noise "
                       "or hiss; the track also feels weaker in playlist "
                       "context next to normalised neighbours.",
    )


@rule
def low_mid_mud_trance(analysis: dict[str, Any]) -> Verdict | None:
    p3 = _phase(analysis, "phase3")
    energy = p3.get("low_mid_energy")
    genre = (analysis.get("genre_hint") or "").lower()
    if energy is None or genre != "trance" or energy <= 0.20:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="moderate",
        category="low_end",
        headline=f"Low-mid mud high for trance ({energy:.2f})",
        summary=f"Low-mid energy is {energy:.2f}; trance reference targets are "
                "0.10–0.15. The kick-bass region is competing for clarity.",
        evidence=[Evidence(
            metric="phase3.low_mid_energy",
            value=float(energy),
            expected_range=(0.10, 0.15),
            label=f"{energy:.2f} (trance target ≤0.20)",
        )],
        why_it_matters="Trance lives or dies on a clean kick-bass relationship. "
                       "Excess low-mid energy buries the punch and makes "
                       "drops feel cluttered on club systems.",
    )


@rule
def low_mid_mud_generic(analysis: dict[str, Any]) -> Verdict | None:
    # Skip if the trance-specific rule already fired (avoid duplicate; dedupe
    # would merge anyway, but the messages would conflict).
    p3 = _phase(analysis, "phase3")
    energy = p3.get("low_mid_energy")
    genre = (analysis.get("genre_hint") or "").lower()
    if energy is None or energy <= 0.25 or genre == "trance":
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="moderate",
        category="low_end",
        headline=f"Low-mid energy high ({energy:.2f})",
        summary=f"Low-mid energy is {energy:.2f}; most genres target 0.15–0.20. "
                "Mud is masking definition between elements.",
        evidence=[Evidence(
            metric="phase3.low_mid_energy",
            value=float(energy),
            expected_range=(0.15, 0.20),
            label=f"{energy:.2f}",
        )],
        why_it_matters="The 200-500 Hz region builds up fast. Without a "
                       "subtractive cut on bass, pad, or guitar, the mix loses "
                       "headroom and clarity.",
    )


@rule
def excessive_dynamic_range(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    cf = p1.get("crest_factor")
    if cf is None or cf <= 22.0:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="minor",
        category="dynamics",
        headline=f"Very wide dynamic range (crest {cf:.1f} dB)",
        summary=f"Crest factor is {cf:.1f} dB. For most playback contexts, "
                "extra-wide dynamics get squashed by listener volume control "
                "or platform normalisation anyway.",
        evidence=[Evidence(
            metric="phase1.crest_factor",
            value=float(cf),
            expected_range=(8.0, 18.0),
            label=f"{cf:.1f} dB",
        )],
        why_it_matters="Listeners turn down loud peaks and can't hear quiet "
                       "passages. Some compression preserves intent better "
                       "than relying on the listener to ride the volume knob.",
    )


@rule
def tiny_dynamic_range(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    cf = p1.get("crest_factor")
    if cf is None or cf >= 4.0:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="severe",
        category="dynamics",
        headline=f"Severely squashed dynamics (crest {cf:.1f} dB)",
        summary=f"Crest factor is only {cf:.1f} dB. The mix has been hammered "
                "flat — transient detail is gone, the track will feel "
                "fatiguing on full playback.",
        evidence=[Evidence(
            metric="phase1.crest_factor",
            value=float(cf),
            expected_range=(8.0, 14.0),
            label=f"{cf:.1f} dB (target ≥6 dB)",
        )],
        why_it_matters="Below 4 dB crest, listener fatigue spikes within 30s "
                       "and the mix loses anything that could be called "
                       "a transient. Limiter is doing too much work.",
    )


@rule
def stereo_correlation_negative(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    corr = p1.get("stereo_correlation")
    if corr is None or corr >= -0.1:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="severe",
        category="stereo_phase",
        headline=f"Negative stereo correlation ({corr:+.2f})",
        summary=f"Stereo correlation is {corr:+.2f}. Channels are partially "
                "out of phase — this collapses to a hollow mono and sounds "
                "wrong on most playback chains.",
        evidence=[Evidence(
            metric="phase1.stereo_correlation",
            value=float(corr),
            expected_range=(0.2, 1.0),
            label=f"{corr:+.2f} (target ≥0.2)",
        )],
        why_it_matters="Negative correlation is almost always a stereo widener "
                       "or M/S processing gone wrong. Mono compatibility "
                       "fails, sub-bass disappears, headphone listeners hear "
                       "spatial weirdness.",
    )


@rule
def key_detection_low_confidence(analysis: dict[str, Any]) -> Verdict | None:
    p1 = _phase(analysis, "phase1")
    conf = p1.get("key_detection_confidence")
    if conf is None or conf >= 0.5:
        return None
    return _make(
        track_id=_track_id(analysis),
        severity="minor",
        category="harmonic",
        confidence=float(conf),
        headline=f"Key detection unsure (confidence {conf:.2f})",
        summary="The harmonic content is ambiguous — could be modal, "
                "atonal, or simply unusual. Manual key labelling is more "
                "reliable than the auto-detected value.",
        evidence=[Evidence(
            metric="phase1.key_detection_confidence",
            value=float(conf),
            expected_range=(0.5, 1.0),
            label=f"{conf:.2f} confidence",
        )],
        why_it_matters="Auto-detected key drives genre comparison and "
                       "harmonic-mixing recommendations downstream. A wrong "
                       "key label produces nonsense suggestions.",
    )
