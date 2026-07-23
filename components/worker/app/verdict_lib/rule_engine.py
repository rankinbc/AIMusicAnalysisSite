"""Deterministic IDENTIFY-tier rule engine — emits Problem records (Verdicts with
``fix=None``; the SOLVE tier attaches fixes later).

**Two-pass Problem engine** ``@single`` / ``@composite`` / ``evaluate_problems``
— the MixCoach tiered engine, and since 2026-07-23 the SOLE rule path (the
legacy flat ``@rule`` / ``evaluate_rules`` registry was retired; every legacy
rule's coverage lives on in a new-engine equivalent). Pass 1 runs every
Tier-A/B/S/P *single* (one metric → one Problem); pass 2 runs Tier-C
*composites* (corroborated, multi-metric), then ``suppression.apply`` lets each
composite absorb its child singles (consolidation + audit trail). Thresholds
are **genre-relative**, resolved from ``config/genre-profiles.json`` via
``genre_config`` — the same measured value yields a different severity per
genre. Rules tagged ``suspected=True`` ship on placeholder thresholds pending a
measured corpus; rules carry a ``data_tier`` (audio_only / stems / project_midi)
and never grade absent data (every rule guards its inputs and returns ``None``).

The two-pass engine is LIVE on EVERY completed analysis: ``degraded.py`` calls
``evaluate_problems``, validates, and persists the Problem columns, and
``tasks_dramatiq.analyze_audio_job`` Phase C2 invokes it on the healthy path too
(idempotent + best-effort).
"""
from __future__ import annotations
import logging
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

from app.verdict_lib import genre_config as G
from app.verdict_lib.suppression import apply as _apply_suppression

logger = logging.getLogger(__name__)

RULE_ENGINE_VERSION = "rule_engine@1.0.0"
RULE_MODEL = "rules"


def _track_id(analysis: dict[str, Any]) -> str:
    return analysis.get("track_id", "unknown-track")


def _phase(analysis: dict[str, Any], key: str) -> dict[str, Any]:
    return analysis.get(key) or {}


# ── Two-pass Problem engine (singles → composites + suppression) ─────────────
# Rules emit the richer Problem shape (problem_id/kind/data_tier/…) via
# `_problem`.

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
    trace: dict[str, list[Any]] | None = None,
) -> list[Verdict]:
    """Two-pass evaluation: run all singles, then composites, then apply
    suppression. Registries default to the module globals; pass explicit ones
    in tests to avoid touching the global set.

    ``trace`` (optional): when a dict is passed, each rule's fire/skip decision is
    appended to ``trace["singles"]`` / ``trace["composites"]`` for the run-trace
    harness. Default ``None`` → byte-identical hot path, zero overhead."""
    singles = _SINGLES if singles is None else singles
    composites = _COMPOSITES if composites is None else composites
    fired: dict[str, Verdict] = {}
    for slug, fn in singles:
        # Per-rule isolation: a single rule that throws (e.g. a bad metric type)
        # must not wipe the whole batch of findings. Log and skip it.
        try:
            v = fn(analysis)
        except Exception:
            logger.exception("rule engine: single %r raised; skipping", slug)
            if trace is not None:
                trace.setdefault("singles", []).append(
                    {"slug": slug, "fired": False, "error": True})
            continue
        if trace is not None:
            trace.setdefault("singles", []).append({
                "slug": slug,
                "fired": v is not None,
                "severity": v.severity if v is not None else None,
                "category": v.category if v is not None else None,
                "problem_id": v.problem_id if v is not None else None,
            })
        if v is not None:
            fired[slug] = v
    hits = []
    for slug, suppresses, cfn in composites:
        try:
            cv = cfn(analysis, fired)
        except Exception:
            logger.exception("rule engine: composite %r raised; skipping", slug)
            if trace is not None:
                trace.setdefault("composites", []).append(
                    {"slug": slug, "fired": False, "error": True, "suppresses": suppresses})
            continue
        if trace is not None:
            trace.setdefault("composites", []).append({
                "slug": slug,
                "fired": cv is not None,
                "suppresses": suppresses,
                "severity": cv.severity if cv is not None else None,
            })
        if cv is not None:
            hits.append((slug, suppresses, cv))
    return _apply_suppression(fired, hits)


# ── TIER B — fire from the phase-1 datapoint lifts (final_json schema 2.1.0) ──


@single("channel_imbalance", tier="B")
def channel_imbalance(a: dict[str, Any]) -> Verdict | None:
    """Sustained L/R level offset (supersedes the weak A14 proxy)."""
    bal = (_phase(a, "phase1").get("channel_balance") or {}).get("balance_db")
    if bal is None:
        return None
    sev = _tiered(abs(bal), {"severe": 6.0, "moderate": 3.0}, higher_is_worse=True)
    if sev is None:
        return None
    side = "left" if bal > 0 else "right"
    return _problem(
        track_id=_track_id(a), slug="channel_imbalance", severity=sev,
        category="stereo_field", kind="fault",
        headline=f"Channel imbalance — {side} louder by {abs(bal):.1f} dB",
        summary=f"The {side} channel runs {abs(bal):.1f} dB hotter; a sustained "
                "L/R offset pulls the stereo image off-centre.",
        evidence=[Evidence(metric="phase1.channel_balance.balance_db", value=float(bal),
                           expected_range=(-3.0, 3.0), label=f"{bal:+.1f} dB")],
        why_it_matters="A persistent L/R level offset skews the stereo image and "
                       "usually signals a panning or gain-staging error.",
    )


@single("sub_rumble", tier="B")
def sub_rumble(a: dict[str, Any]) -> Verdict | None:
    """Infrasonic energy below ~30 Hz eating limiter headroom."""
    p1 = _phase(a, "phase1")
    sub30 = p1.get("sub_30_energy")
    low = p1.get("low_energy")
    if sub30 is None or not low:
        return None
    ratio = sub30 / low
    if ratio < 0.35:  # placeholder: a meaningful fraction of the 20-200 Hz low band
        return None
    return _problem(
        track_id=_track_id(a), slug="sub_rumble", severity="minor",
        category="low_end", kind="fault", suspected=True,
        headline="Sub-30 Hz rumble wasting headroom",
        summary=f"Energy below 30 Hz is {ratio * 100:.0f}% of the 20-200 Hz low "
                "band — mostly inaudible rumble eating limiter headroom.",
        evidence=[Evidence(metric="phase1.sub_30_energy", value=float(sub30),
                           frequency_range_hz=(0.0, 30.0),
                           label=f"{ratio * 100:.0f}% of low band")],
        why_it_matters="Infrasonic content below ~30 Hz is rarely audible but "
                       "costs headroom; a steep high-pass recovers it.",
    )


@single("modal_ambiguity", tier="B")
def modal_ambiguity(a: dict[str, Any]) -> Verdict | None:
    """Top-two key fits within a small margin — ambiguous tonal centre.
    Observation only (fixable=False): there's nothing to "fix"."""
    ke = _phase(a, "phase1").get("key_estimate") or {}
    corrs = ke.get("profile_corrs")
    if not corrs or len(corrs) < 2:
        return None
    top = sorted(corrs, reverse=True)
    margin = top[0] - top[1]
    if top[0] < 0.5 or margin > 0.05:  # no real tonal centre, or one key clearly wins
        return None
    conf = ke.get("confidence")
    if conf is None:
        return None
    return _problem(
        track_id=_track_id(a), slug="modal_ambiguity", severity="moderate",
        category="harmonic", kind="observation", fixable=False,
        headline=f"Ambiguous key: {ke.get('key')} {ke.get('mode')} vs "
                 f"{ke.get('second_key')} {ke.get('second_mode')}",
        summary=f"The top two key fits are within {margin:.3f}; the track reads as "
                f"ambiguous between {ke.get('key')} {ke.get('mode')} and "
                f"{ke.get('second_key')} {ke.get('second_mode')} (often relative major/minor).",
        evidence=[Evidence(metric="phase1.key_estimate.confidence", value=float(conf),
                           expected_range=(0.5, 1.0), label=f"top-2 margin {margin:.3f}")],
        why_it_matters="An ambiguous tonal centre makes auto key + harmonic-mixing "
                       "labels unreliable; confirm the key by ear.",
    )


@single("missing_sidechain", tier="B")
def missing_sidechain(a: dict[str, Any]) -> Verdict | None:
    """No sidechain pumping signature on a dense low end. CONSERVATIVE + suspected:
    the lifted loudness_timeline is full-band 0.4 s momentary, which can't resolve a
    sub-100 ms kick-duck — robust detection needs a low-band envelope lift (TODO).
    Until then this fires only on the clear case: flat momentary modulation + dense
    low end, gated on beats present."""
    import statistics

    p1 = _phase(a, "phase1")
    series = ((p1.get("loudness_timeline") or {}).get("momentary") or {}).get("lufs") or []
    beats = (p1.get("structure") or {}).get("beats") or []
    low = p1.get("low_energy")
    if len(series) < 8 or len(beats) < 8 or not low:
        return None
    spread = statistics.pstdev(series)
    if spread > 1.5 or low < 0.2:  # placeholder thresholds — unvalidated (TODO: corpus)
        return None
    return _problem(
        track_id=_track_id(a), slug="missing_sidechain", severity="moderate",
        category="low_end", kind="observation", suspected=True,
        headline="No sidechain pumping signature on a dense low end",
        summary=f"Momentary loudness barely modulates (sigma {spread:.2f} LU) over a dense "
                "low end — no ducking pattern, so kick and bass may be masking, not pumping.",
        evidence=[Evidence(metric="phase1.low_energy", value=float(low),
                           label=f"sigma {spread:.2f} LU, low_energy {low:.2f}")],
        why_it_matters="In most electronic genres the bass ducks under the kick; without it "
                       "the low end congests and loses punch.",
    )


@composite("untreated_low_end", suppresses=["missing_sidechain", "thin_low_end"])
def untreated_low_end(a: dict[str, Any], fired: dict[str, Verdict]) -> Verdict | None:
    """Routing composite: dense, hot low end with no ducking signature → the fix is
    sidechain (with stems) or a complementary EQ carve."""
    if "missing_sidechain" not in fired:
        return None
    p1 = _phase(a, "phase1")
    bass = (p1.get("bands") or {}).get("bass")
    low = p1.get("low_energy")
    if bass is None or low is None:
        return None
    if not (bass > -12.0 and low > 0.35):  # bands are dB-rel-peak (<=0); "hot" = near 0
        return None
    return _problem(
        track_id=_track_id(a), slug="untreated_low_end", severity="severe", confidence=0.9,
        category="low_end", kind="fault", suspected=False,
        headline="Dense low end with no ducking signature",
        summary="Sub/bass bands are hot, the low end is dense, and there's no sidechain "
                "pumping — kick and bass are competing untreated.",
        evidence=[
            Evidence(metric="phase1.bands.bass", value=float(bass),
                     expected_range=(-18.0, -12.0), label="bass hot"),
            Evidence(metric="phase1.low_energy", value=float(low),
                     expected_range=(0.2, 0.35), label="LF energy high"),
        ],
        why_it_matters="A dense low end without ducking congests the mix; the fix is sidechain "
                       "(with stems) or a complementary EQ carve.",
    )


# ── TIER A — fire from exposed phase-1/phase-9 fields ────────────────────────


def _genre(a: dict[str, Any]) -> str | None:
    return _phase(a, "phase2").get("genre")


@single("true_peak_overshoot", tier="A")
def true_peak_overshoot(a: dict[str, Any]) -> Verdict | None:
    """True peak over the genre ceiling (binding A1) + hot-master rule."""
    p1 = _phase(a, "phase1")
    tp = p1.get("true_peak_db")
    if tp is None:
        return None
    g, ctx = _genre(a), G.master_context()
    ceiling = G.ppath(g, f"loudness.{ctx}.true_peak_dbtp_max", -1.0)
    lufs = p1.get("lufs")
    if lufs is not None and lufs > G.platform("hot_master_threshold_lufs", -14.0):
        ceiling = G.platform("hot_master_true_peak_dbtp", -2.0)
    if tp <= ceiling:
        return None
    sev: Severity = "severe" if tp > 0.0 else ("moderate" if tp > ceiling + 0.7 else "minor")
    return _problem(
        track_id=_track_id(a), slug="true_peak_overshoot", severity=sev, category="clipping",
        kind="fault", headline=f"True peak {tp:+.2f} dBTP - over {ceiling:.1f} ceiling",
        summary=f"Inter-sample true peak exceeds the {ceiling:.1f} dBTP ceiling; codec re-encoding will clip.",
        evidence=[Evidence(metric="phase1.true_peak_db", value=float(tp),
                           expected_range=(-6.0, ceiling), label=f"{tp:+.2f} dBTP")],
        why_it_matters="Lossy codecs (AAC/Opus) raise peaks on re-encode; over the ceiling risks audible distortion.",
    )


@single("clipping_count", tier="A")
def clipping_count(a: dict[str, Any]) -> Verdict | None:
    p1 = _phase(a, "phase1")
    if not p1.get("clipping_detected"):
        return None
    n = int(p1.get("clipped_sample_count", 0))
    if n < 1:
        return None
    sev: Severity = "severe" if n > 1000 else ("moderate" if n > 100 else "minor")
    return _problem(
        track_id=_track_id(a), slug="clipping_count", severity=sev, category="clipping",
        kind="fault", headline=f"Hard clipping ({n} samples)",
        summary="The signal hits digital full-scale; distortion is baked in and unfixable downstream.",
        evidence=[Evidence(metric="phase1.clipped_sample_count", value=float(n), label=f"{n} samples")],
        why_it_matters="Clipping is irreversible - limiting/mastering downstream cannot remove it.",
    )


@single("loudness_vs_target", tier="A")
def loudness_vs_target(a: dict[str, Any]) -> Verdict | None:
    """Signed deviation from the genre's target for the active master_context (binding A2)."""
    lufs = _phase(a, "phase1").get("lufs")
    if lufs is None:
        return None
    g, ctx = _genre(a), G.master_context()
    target = G.ppath(g, f"loudness.{ctx}.lufs_target") or G.ppath(g, "loudness.streaming.lufs_target", -14.0)
    tol = G.ppath(g, "loudness.streaming.lufs_tolerance", 1.5)
    delta = lufs - target
    if abs(delta) <= tol or abs(delta) <= 3:  # win-band / below-moderate -> no card
        return None
    sev: Severity = "severe" if abs(delta) > 6 else "moderate"
    direction = "loud" if delta > 0 else "quiet"
    return _problem(
        track_id=_track_id(a), slug="loudness_vs_target", severity=sev, category="loudness",
        kind="fault", headline=f"Master too {direction} ({lufs:.1f} LUFS)",
        summary=f"Integrated loudness {lufs:.1f} LUFS is {abs(delta):.1f} LU from the {target:.0f} "
                f"{ctx} target for {G.resolve_genre(g)}.",
        evidence=[Evidence(metric="phase1.lufs", value=float(lufs),
                           expected_range=(target - 3, target + 3), label=f"{lufs:.1f} LUFS")],
        why_it_matters="Streaming normalises to its target; too loud burns dynamics, too quiet gains up noise.",
    )


@single("over_compression", tier="A")
def over_compression(a: dict[str, Any]) -> Verdict | None:
    """Squashed dynamics vs the genre ideal (binding A3). suspected; techno's
    inherently low LRA needs crest corroboration before firing."""
    p1 = _phase(a, "phase1")
    lra = p1.get("loudness_range_lu")
    cf = p1.get("crest_factor")
    if lra is None and cf is None:
        return None
    g = _genre(a)
    lra_range = G.ppath(g, "dynamics.lra_lu.range", [5.0, 9.0])
    crest_warn = G.ppath(g, "dynamics.crest_db.warn_below", 6.0)
    lra_lo = lra_range[0]
    crest_low = cf is not None and cf < crest_warn
    if G.resolve_genre(g) == "techno" and not crest_low:
        return None  # techno's low LRA is inherent - require crest corroboration
    sev: Severity | None = None
    if lra is not None and lra < (lra_lo - 2) and crest_low:
        sev = "severe"
    elif (lra is not None and lra < lra_lo) or crest_low:
        sev = "moderate"
    if sev is None:
        return None
    ev = []
    if lra is not None:
        ev.append(Evidence(metric="phase1.loudness_range_lu", value=float(lra),
                           expected_range=tuple(lra_range), label=f"{lra:.1f} LU"))
    if cf is not None:
        ideal = G.ppath(g, "dynamics.crest_db.range", [7.0, 12.0])
        ev.append(Evidence(metric="phase1.crest_factor", value=float(cf),
                           expected_range=tuple(ideal), label=f"{cf:.1f} dB crest"))
    return _problem(
        track_id=_track_id(a), slug="over_compression", severity=sev, category="dynamics",
        kind="observation", suspected=True, headline="Heavily compressed - dynamics squashed",
        summary=f"Loudness range / crest are below the {G.resolve_genre(g)} ideal. Sometimes a genre choice.",
        evidence=ev,
        why_it_matters="Over-limiting kills transients and fatigues listeners; the genre ideal sets how far is too far.",
    )


@single("weak_transients", tier="A")
def weak_transients(a: dict[str, Any]) -> Verdict | None:
    """Weak onset envelope - dull attack / little punch (binding A_weak_transients).
    suspected: avg_transient_strength is mean librosa onset_strength, which scales
    with level/normalization and is NOT a calibrated absolute - this is a soft hint;
    the corroborated signal is the Tier-C `lost_transients` composite. Not fixable
    on the master (no transient-shaper DspOp); the corrective move is leftover advice."""
    avg = (_phase(a, "phase1").get("transients") or {}).get("avg_transient_strength")
    if avg is None:
        return None
    g = _genre(a)
    floor = G.ppath(g, "dynamics.transient_strength.weak_below", 0.8)
    sev = _tiered(avg, {"severe": floor * 0.5, "moderate": floor}, higher_is_worse=False)
    if sev is None:
        return None
    return _problem(
        track_id=_track_id(a), slug="weak_transients", severity=sev, category="dynamics",
        kind="observation", suspected=True, fixable=False,
        headline=f"Weak transient attack ({avg:.2f})",
        summary=f"Mean onset strength {avg:.2f} is below the {G.resolve_genre(g)} floor - "
                "dull attack / little punch. Placeholder threshold pending a measured corpus.",
        evidence=[Evidence(metric="phase1.transients.avg_transient_strength", value=float(avg),
                           expected_range=(floor, floor * 3), label=f"{avg:.2f}")],
        why_it_matters="Weak transients read as a soft, lifeless attack; kicks and snares "
                       "don't punch through on club or playlist playback.",
    )


@single("unstable_loudness", tier="A")
def unstable_loudness(a: dict[str, Any]) -> Verdict | None:
    """Short-term loudness spiking far above the integrated level - inconsistent
    section-to-section levels (binding A_unstable_loudness). Grounded in a measured
    LUFS relationship (EBU R128 programme-dynamics, the LRA family); the cutoff is a
    rule-of-thumb so suspected=True. Not a gain-trim fix -> fixable=False."""
    p1 = _phase(a, "phase1")
    lufs = p1.get("lufs")
    st = p1.get("short_term_max_lufs")
    mom = p1.get("momentary_max_lufs")
    if lufs is None or st is None or mom is None:
        return None
    st_spread = st - lufs
    g = _genre(a)
    floor = G.ppath(g, "loudness.stability.short_term_over_integrated_lu", 6.0)
    sev = _tiered(st_spread, {"severe": floor + 3, "moderate": floor}, higher_is_worse=True)
    if sev is None:
        return None
    mom_spread = mom - lufs
    return _problem(
        track_id=_track_id(a), slug="unstable_loudness", severity=sev, category="loudness",
        kind="fault", suspected=True, fixable=False,
        headline=f"Unstable loudness (+{st_spread:.1f} LU short-term)",
        summary=f"Short-term loudness peaks {st_spread:.1f} LU above integrated "
                f"(momentary +{mom_spread:.1f} LU) - the level swings wide between sections.",
        evidence=[
            Evidence(metric="phase1.short_term_max_lufs", value=float(st),
                     label=f"+{st_spread:.1f} LU over integrated"),
            Evidence(metric="phase1.momentary_max_lufs", value=float(mom),
                     label=f"+{mom_spread:.1f} LU momentary"),
        ],
        why_it_matters="Short-term spikes far above the integrated level mean the track swings "
                       "between quiet and slamming; loud sections fatigue and normalisation pumps.",
    )


@single("sub_mono_compatibility", tier="A")
def sub_mono_compatibility(a: dict[str, Any]) -> Verdict | None:
    mono = _phase(a, "phase1").get("mono_compatibility")
    if mono is None:
        return None
    sev = _tiered(mono, {"severe": 0.4, "moderate": 0.6}, higher_is_worse=False)
    if sev is None:
        return None
    return _problem(
        track_id=_track_id(a), slug="sub_mono_compatibility", severity=sev,
        category="mono_compatibility", kind="fault",
        headline=f"Mono fold-down loses energy ({mono:.2f})",
        summary=f"Mono-sum RMS is only {mono:.2f} of stereo - phase content collapses on mono/club systems.",
        evidence=[Evidence(metric="phase1.mono_compatibility", value=float(mono),
                           expected_range=(0.6, 1.0), label=f"{mono:.2f}")],
        why_it_matters="Club, phone-speaker, and Bluetooth playback sum to mono; energy lost there sounds thin.",
    )


@single("negative_correlation", tier="A")
def negative_correlation(a: dict[str, Any]) -> Verdict | None:
    corr = _phase(a, "phase1").get("stereo_correlation")
    if corr is None:
        return None
    sev = _tiered(corr, {"severe": -0.3, "moderate": 0.0}, higher_is_worse=False)
    if sev is None:
        return None
    return _problem(
        track_id=_track_id(a), slug="negative_correlation", severity=sev,
        category="stereo_phase", kind="fault",
        headline=f"Out-of-phase stereo ({corr:+.2f})",
        summary=f"Stereo correlation is {corr:+.2f}; channels are partly out of phase and cancel in mono.",
        evidence=[Evidence(metric="phase1.stereo_correlation", value=float(corr),
                           expected_range=(0.2, 1.0), label=f"{corr:+.2f}")],
        why_it_matters="Negative correlation usually means an over-pushed widener; mono fold-down hollows out.",
    )


@single("width_instability", tier="A")
def width_instability(a: dict[str, Any]) -> Verdict | None:
    wc = (_phase(a, "phase9").get("spatial") or {}).get("width_consistency")
    if wc is None:
        return None
    sev = _tiered(wc, {"moderate": 40.0, "minor": 60.0}, higher_is_worse=False)
    if sev is None:
        return None
    return _problem(
        track_id=_track_id(a), slug="width_instability", severity=sev, category="spatial",
        kind="fault", headline=f"Stereo width wanders ({wc:.0f}/100)",
        summary=f"Stereo-image consistency is {wc:.0f}/100; the width shifts over time rather than staying stable.",
        evidence=[Evidence(metric="phase9.spatial.width_consistency", value=float(wc),
                           expected_range=(60.0, 100.0), label=f"{wc:.0f}/100")],
        why_it_matters="An unstable image makes the mix feel restless and translates unpredictably across systems.",
    )


# ── TIER A — structure + tempo (genre-driven) ────────────────────────────────

_SECTION_FLAG = {
    "intro": "has_intro", "buildup": "has_buildup", "drop": "has_drop",
    "breakdown": "has_breakdown", "outro": "has_outro",
}


@single("missing_section", tier="A")
def missing_section(a: dict[str, Any]) -> Verdict | None:
    """A genre-required arrangement section is absent (binding A15). Never flags
    techno (linear_hypnotic) for a missing drop — its required set omits it.
    Only judged once arrangement detection has actually scored."""
    p7 = _phase(a, "phase7")
    if p7.get("arrangement_status") != "scored":
        return None
    meta = p7.get("metadata") or {}
    g = _genre(a)
    required = G.ppath(g, "arrangement.required_sections", []) or []
    structure_type = G.ppath(g, "arrangement.structure_type", "")
    missing = [s for s in required if s in _SECTION_FLAG and not meta.get(_SECTION_FLAG[s], False)]
    if not missing:
        return None
    if structure_type == "breakdown_drop" and "drop" in missing:
        sev: Severity = "severe"
        first = "drop"
    else:
        sev = "moderate"
        first = missing[0]
    sc = meta.get("section_count", 0)
    return _problem(
        track_id=_track_id(a), slug="missing_section", severity=sev, category="sections",
        kind="fault", headline=f"Missing {first} section",
        summary=f"The {G.resolve_genre(g)} arrangement expects {', '.join(required)}; "
                f"this track is missing: {', '.join(missing)}.",
        evidence=[Evidence(metric="phase7.metadata.section_count", value=float(sc),
                           label=f"no {first} ({sc} sections)")],
        why_it_matters="A genre-standard arrangement sets listener expectations; a missing key "
                       "section reads as unfinished.",
    )


@single("eight_bar_violations", tier="A")
def eight_bar_violations(a: dict[str, Any]) -> Verdict | None:
    p7 = _phase(a, "phase7")
    if p7.get("arrangement_status") != "scored":
        return None
    score = p7.get("eight_bar_score")
    if score is None:
        return None
    sev = _tiered(score, {"moderate": 50.0, "minor": 70.0}, higher_is_worse=False)
    if sev is None:
        return None
    return _problem(
        track_id=_track_id(a), slug="eight_bar_violations", severity=sev, category="sections",
        kind="fault", headline=f"Sections break the 8-bar grid ({score:.0f}/100)",
        summary=f"Eight-bar compliance is {score:.0f}/100; section lengths aren't landing on "
                "8/16-bar phrases.",
        evidence=[Evidence(metric="phase7.eight_bar_score", value=float(score),
                           expected_range=(70.0, 100.0), label=f"{score:.0f}/100")],
        why_it_matters="DJ-friendly arrangements phrase in 8s; off-grid sections make beatmatching "
                       "and mixing awkward.",
    )


@single("bpm_genre_match", tier="A")
def bpm_genre_match(a: dict[str, Any]) -> Verdict | None:
    """Soft tempo-vs-genre sanity (binding bpm_genre_match). Never an error —
    subgenres span wide; suspected."""
    bpm = _phase(a, "phase1").get("bpm")
    if bpm is None:
        return None
    g = _genre(a)
    lo = G.ppath(g, "bpm.min")
    hi = G.ppath(g, "bpm.max")
    if lo is None or hi is None or lo <= bpm <= hi:
        return None
    return _problem(
        track_id=_track_id(a), slug="bpm_genre_match", severity="minor", category="sections",
        kind="observation", suspected=True,
        headline=f"BPM {bpm:.0f} outside {G.resolve_genre(g)} range",
        summary=f"Tempo {bpm:.0f} is outside the typical {lo:.0f}-{hi:.0f} BPM for "
                f"{G.resolve_genre(g)}. Subgenres span wide — not an error.",
        evidence=[Evidence(metric="phase1.bpm", value=float(bpm),
                           expected_range=(float(lo), float(hi)), label=f"{bpm:.0f} BPM")],
        why_it_matters="A tempo far outside the genre norm can signal a half/double-time detection "
                       "or a genre mismatch.",
    )


@single("tempo_octave_error", tier="A")
def tempo_octave_error(a: dict[str, Any]) -> Verdict | None:
    """Phase-1 beat tracker disagrees with allin1 structure BPM by an octave
    (half/double-time). Measurement-integrity caveat, not a mix fault.
    Genre-independent — no genre-profiles binding."""
    p1 = _phase(a, "phase1")
    bpm = p1.get("bpm")
    struct_bpm = (p1.get("structure") or {}).get("bpm")
    if bpm is None or not struct_bpm:
        return None
    ratio = bpm / struct_bpm
    half = 0.47 <= ratio <= 0.53
    double = 1.89 <= ratio <= 2.11
    if not (half or double):
        return None
    direction = "half-time" if half else "double-time"
    return _problem(
        track_id=_track_id(a), slug="tempo_octave_error", severity="minor",
        category="sections", kind="integrity", fixable=False,
        headline=f"Detected BPM {bpm:.0f} looks {direction} of the true {struct_bpm:.0f}",
        summary=(
            f"The beat tracker reported {bpm:.1f} BPM but structure analysis measured "
            f"{struct_bpm:.1f} BPM (ratio {ratio:.2f}) — a classic {direction} octave error. "
            f"Treat {struct_bpm:.0f} BPM as the working tempo."
        ),
        evidence=[
            Evidence(metric="phase1.bpm", value=float(bpm),
                     label=f"{bpm:.1f} BPM (beat tracker)"),
            Evidence(metric="phase1.structure.bpm", value=float(struct_bpm),
                     label=f"{struct_bpm:.1f} BPM (structure)"),
        ],
        why_it_matters=(
            "Genre matching and danceability scoring read the beat-tracker BPM; an octave "
            "error skews both and the displayed tempo."
        ),
    )


# ── TIER A — tonal / spectral (A7-A12). PLACEHOLDER thresholds, suspected: ───
# genre-profiles.json carries only QUALITATIVE spectral hints (brightness_rank,
# width_character, *_emphasis), no firing numbers. These ship suspected=True with
# documented placeholder bases scaled by the hint, pending a measured corpus
# (genre-profiles.json::_tuning_notes). Do NOT treat the numbers as validated.


@single("thin_low_end", tier="A")
def thin_low_end(a: dict[str, Any]) -> Verdict | None:
    low = _phase(a, "phase1").get("low_energy")
    if low is None or low >= 0.12:  # placeholder floor
        return None
    sev: Severity = "severe" if low < 0.06 else "moderate"
    return _problem(
        track_id=_track_id(a), slug="thin_low_end", severity=sev, category="low_end",
        kind="observation", suspected=True, headline=f"Thin low end (LF energy {low:.2f})",
        summary=f"Low-frequency (20-200 Hz) energy is {low:.2f} - light for most dance genres. "
                "Placeholder floor pending a corpus.",
        evidence=[Evidence(metric="phase1.low_energy", value=float(low),
                           expected_range=(0.12, 0.5), label=f"{low:.2f}")],
        why_it_matters="A weak low end robs a track of body and club impact.",
    )


@single("mud_buildup", tier="A")
def mud_buildup(a: dict[str, Any]) -> Verdict | None:
    bands = _phase(a, "phase1").get("bands") or {}
    lm, mid = bands.get("low_mid"), bands.get("mid")
    if lm is None or mid is None:
        return None
    diff = lm - mid  # both dB-rel-peak; the difference is normalization-stable
    if diff <= 3.0:  # placeholder base (genre scaling by low_mid_emphasis TODO)
        return None
    sev: Severity = "severe" if diff > 6.0 else "moderate"
    return _problem(
        track_id=_track_id(a), slug="mud_buildup", severity=sev, category="frequency_balance",
        kind="observation", suspected=True, headline=f"Low-mid buildup ({diff:.1f} dB over mid)",
        summary=f"The 200-500 Hz low-mid sits {diff:.1f} dB above the mid band - the signature of a "
                "muddy, congested mix.",
        evidence=[Evidence(metric="phase1.bands.low_mid", value=float(lm),
                           frequency_range_hz=(200.0, 500.0),
                           label=f"low-mid {diff:.1f} dB over mid")],
        why_it_matters="Excess low-mid masks definition; a subtractive cut opens the mix up.",
    )


@single("harsh_upper_mid", tier="A")
def harsh_upper_mid(a: dict[str, Any]) -> Verdict | None:
    p1 = _phase(a, "phase1")
    centroid = p1.get("spectral_centroid_hz")
    um = (p1.get("bands") or {}).get("upper_mid")
    if centroid is None and um is None:
        return None
    g = _genre(a)
    rank = G.ppath(g, "spectral.brightness_rank", 2) or 2
    ceiling = 4000.0 + (3 - rank) * 600.0  # placeholder: brighter genres tolerate more
    if not ((centroid is not None and centroid > ceiling) or (um is not None and um > -38.0)):
        return None
    if centroid is not None:
        ev = Evidence(metric="phase1.spectral_centroid_hz", value=float(centroid),
                      expected_range=(1000.0, ceiling), label=f"centroid {centroid:.0f} Hz")
    else:
        ev = Evidence(metric="phase1.bands.upper_mid", value=float(um or 0.0),
                      frequency_range_hz=(2000.0, 5000.0), label="upper-mid hot")
    return _problem(
        track_id=_track_id(a), slug="harsh_upper_mid", severity="moderate",
        category="frequency_balance", kind="observation", suspected=True,
        headline="Bright / harsh upper mids",
        summary=f"2-5 kHz content reads hot for {G.resolve_genre(g)} (brightness rank {rank}); can "
                "fatigue the ear. Placeholder thresholds.",
        evidence=[ev],
        why_it_matters="2-5 kHz harshness causes listening fatigue, especially on earbuds.",
    )


@single("dull_no_air", tier="A")
def dull_no_air(a: dict[str, Any]) -> Verdict | None:
    p1 = _phase(a, "phase1")
    air = (p1.get("bands") or {}).get("air")
    centroid = p1.get("spectral_centroid_hz")
    if air is None and centroid is None:
        return None
    g = _genre(a)
    rank = G.ppath(g, "spectral.brightness_rank", 2) or 2
    air_floor = -78.0 + (3 - rank) * 4.0  # placeholder: brighter genres expect more air
    if not ((air is not None and air < air_floor) or (centroid is not None and centroid < 1500.0)):
        return None
    if air is not None:
        ev = Evidence(metric="phase1.bands.air", value=float(air),
                      frequency_range_hz=(8000.0, 22000.0), label=f"air {air:.0f} dB")
    else:
        ev = Evidence(metric="phase1.spectral_centroid_hz", value=float(centroid or 0.0),
                      label=f"centroid {centroid or 0.0:.0f} Hz")
    return _problem(
        track_id=_track_id(a), slug="dull_no_air", severity="moderate",
        category="frequency_balance", kind="observation", suspected=True,
        headline="Dull top end - missing air",
        summary=f"High-frequency air is low for {G.resolve_genre(g)} (brightness rank {rank}); the mix "
                "may sound dull or lossy. Placeholder thresholds.",
        evidence=[ev],
        why_it_matters="Missing air makes a mix feel closed-in or like a lossy export.",
    )


@single("no_tonal_center", tier="A")
def no_tonal_center(a: dict[str, Any]) -> Verdict | None:
    p1 = _phase(a, "phase1")
    flat = p1.get("spectral_flatness")
    conf = p1.get("key_detection_confidence")
    if flat is None or conf is None:
        return None
    if not (flat > 0.4 and conf < 0.5):
        return None
    return _problem(
        track_id=_track_id(a), slug="no_tonal_center", severity="moderate", category="harmonic",
        kind="observation", suspected=True, headline="No clear tonal centre",
        summary=f"Spectral flatness {flat:.2f} (noisy) and key confidence {conf:.2f} (low) together "
                "suggest no dominant key.",
        evidence=[Evidence(metric="phase1.key_detection_confidence", value=float(conf),
                           expected_range=(0.5, 1.0),
                           label=f"key conf {conf:.2f}, flatness {flat:.2f}")],
        why_it_matters="An ambiguous tonal centre weakens harmonic-mixing labels and can read as unmusical.",
    )


@single("over_widened", tier="A")
def over_widened(a: dict[str, Any]) -> Verdict | None:
    width = _phase(a, "phase1").get("stereo_width")
    if width is None:
        return None
    g = _genre(a)
    char = G.ppath(g, "stereo.width_character", "wide") or "wide"
    ceiling = {"widest": 0.45, "wide": 0.40, "narrow_centered": 0.25}.get(char, 0.40)
    if width <= ceiling:
        return None
    return _problem(
        track_id=_track_id(a), slug="over_widened", severity="moderate", category="stereo_field",
        kind="observation", suspected=True,
        headline=f"Possibly over-widened for {G.resolve_genre(g)}",
        summary=f"Stereo width {width:.2f} exceeds the placeholder ceiling for a '{char}' genre; a "
                "stereo imager may be over-pushed. Placeholder threshold.",
        evidence=[Evidence(metric="phase1.stereo_width", value=float(width),
                           expected_range=(0.0, ceiling), label=f"width {width:.2f}")],
        why_it_matters="Over-widening risks mono collapse and an unstable image.",
    )


# ── TIER C — composites (Tier-A/B-input only). Corroborated → suspected=False, ─
# absorb their child singles. C4 untreated_low_end lives above (needs B1);
# C7 no_drop_payoff deferred (needs the section-RMS lift).


@composite("loudness_war", suppresses=["over_compression", "true_peak_overshoot"])
def loudness_war(a: dict[str, Any], fired: dict[str, Verdict]) -> Verdict | None:
    """C1 — crushed dynamics AND peaks against the ceiling: over-limiting, not a
    genre choice. Genre-aware (rule-bindings C1): a techno crest of 5 / LRA 3 is
    inherent, so thresholds defer to the genre's warn_below / static_floor."""
    p1 = _phase(a, "phase1")
    cf, lra, tp = p1.get("crest_factor"), p1.get("loudness_range_lu"), p1.get("true_peak_db")
    if cf is None or lra is None or tp is None:
        return None
    g = _genre(a)
    crest_warn = G.ppath(g, "dynamics.crest_db.warn_below", 6.0)
    lra_floor = G.ppath(g, "dynamics.lra_lu.static_floor", 4.0)
    if not (cf < crest_warn and lra < lra_floor and tp > -0.3):
        return None
    return _problem(
        track_id=_track_id(a), slug="loudness_war", severity="severe", confidence=0.95,
        category="dynamics", kind="fault", suspected=False,
        headline="Over-limited master - dynamics crushed and peaks clipped",
        summary="Crest factor, loudness range, and true peak all indicate aggressive "
                "limiting - corroborated, not a genre choice.",
        evidence=[
            Evidence(metric="phase1.crest_factor", value=float(cf),
                     expected_range=(7.0, 12.0), label="crushed dynamics"),
            Evidence(metric="phase1.loudness_range_lu", value=float(lra),
                     expected_range=(5.0, 9.0), label="low LRA"),
            Evidence(metric="phase1.true_peak_db", value=float(tp),
                     expected_range=(-1.5, -1.0), label="against ceiling"),
        ],
        why_it_matters="Three corroborating metrics mean over-limiting - fix the master "
                       "chain, not one knob.",
    )


@composite("congested_mix", suppresses=["mud_buildup"])
def congested_mix(a: dict[str, Any], fired: dict[str, Verdict]) -> Verdict | None:
    """C2 — low-mid mud confirmed by low spectral contrast + elevated flatness: the
    mix is genuinely congested, not just bumpy in one band. Placeholder spectral
    thresholds (no measured per-genre contrast corpus yet)."""
    if "mud_buildup" not in fired:
        return None
    p1 = _phase(a, "phase1")
    contrast = p1.get("spectral_contrast")
    flat = p1.get("spectral_flatness")
    if contrast is None or flat is None:
        return None
    if not (contrast < 15.0 and flat > 0.3):  # placeholder bands pending a corpus
        return None
    return _problem(
        track_id=_track_id(a), slug="congested_mix", severity="severe", confidence=0.90,
        category="clarity", kind="fault", suspected=False,
        headline="Congested mix - low-mid mud with no spectral separation",
        summary=f"Low-mid buildup, low spectral contrast ({contrast:.0f}) and elevated "
                f"flatness ({flat:.2f}) corroborate a genuinely congested mix.",
        evidence=[
            Evidence(metric="phase1.spectral_contrast", value=float(contrast),
                     label="low contrast"),
            Evidence(metric="phase1.spectral_flatness", value=float(flat),
                     label="elevated flatness"),
        ],
        why_it_matters="Congestion smears every element; a subtractive low-mid carve plus "
                       "separation opens it up.",
    )


@composite("phantom_width", suppresses=["over_widened", "sub_mono_compatibility",
                                        "negative_correlation"])
def phantom_width(a: dict[str, Any], fired: dict[str, Verdict]) -> Verdict | None:
    """C3 — wide image that collapses in mono: over-widening confirmed by poor mono
    compatibility and negative/near-zero correlation. The width is fake."""
    if "over_widened" not in fired:
        return None
    p1 = _phase(a, "phase1")
    mono = p1.get("mono_compatibility")
    corr = p1.get("stereo_correlation")
    if mono is None or corr is None:
        return None
    if not (mono < 0.6 and corr <= 0.1):
        return None
    return _problem(
        track_id=_track_id(a), slug="phantom_width", severity="severe", confidence=0.92,
        category="stereo_field", kind="fault", suspected=False,
        headline="Phantom width - stereo image collapses in mono",
        summary=f"A wide image with mono compatibility {mono:.2f} and correlation "
                f"{corr:.2f} means the width is phase tricks that fold away in mono.",
        evidence=[
            Evidence(metric="phase1.mono_compatibility", value=float(mono),
                     expected_range=(0.6, 1.0), label="poor mono fold"),
            Evidence(metric="phase1.stereo_correlation", value=float(corr),
                     expected_range=(0.3, 1.0), label="near-zero / negative correlation"),
        ],
        why_it_matters="Club and phone playback sum toward mono; phantom width disappears "
                       "and the mix thins out.",
    )


@composite("lifeless_at_source", suppresses=["robotic_velocity", "over_compression"])
def lifeless_at_source(a: dict[str, Any], fired: dict[str, Verdict]) -> Verdict | None:
    """C5 — crushed crest AND robotic MIDI on >=2 tracks with zero velocity spread:
    the lifelessness is baked in at the source, not just the master. Needs phase8."""
    p1 = _phase(a, "phase1")
    cf = p1.get("crest_factor")
    p8 = _phase(a, "phase8")
    if cf is None or not p8:
        return None
    g = _genre(a)
    crest_warn = G.ppath(g, "dynamics.crest_db.warn_below", 6.0)
    if cf >= crest_warn:
        return None
    tracks = p8.get("per_track_analysis") or {}
    robotic = [
        name for name, t in tracks.items()
        if t.get("humanization_score") == "robotic" and (t.get("velocity_std") or 0.0) < 1.0
    ]
    if len(robotic) < 2:
        return None
    return _problem(
        track_id=_track_id(a), slug="lifeless_at_source", severity="severe", confidence=0.93,
        category="humanization", kind="fault", suspected=False, data_tier="project_midi",
        where={"track_names": robotic[:3]},  # FR12: attribute to the robotic named tracks
        headline="Lifeless at the source - crushed crest and robotic MIDI",
        summary=f"Crest factor {cf:.1f} plus zero velocity spread on {len(robotic)} tracks "
                f"({', '.join(robotic[:3])}) - the flatness is in the parts, not the master.",
        evidence=[Evidence(metric="phase1.crest_factor", value=float(cf),
                           expected_range=(7.0, 12.0), label="crushed dynamics")],
        why_it_matters="Mastering cannot add life that was never played in; humanize the "
                       "velocities before touching the bus.",
    )


@composite("thin_and_bright", suppresses=["thin_low_end", "harsh_upper_mid", "dull_no_air"])
def thin_and_bright(a: dict[str, Any], fired: dict[str, Verdict]) -> Verdict | None:
    """C6 — weak low end AND a bright/hot top: a tonal-balance tilt, not two separate
    problems. Placeholder spectral ceiling scaled by the genre brightness rank."""
    if "thin_low_end" not in fired:
        return None
    p1 = _phase(a, "phase1")
    centroid = p1.get("spectral_centroid_hz")
    air = (p1.get("bands") or {}).get("air")
    if centroid is None or air is None:
        return None
    g = _genre(a)
    rank = G.ppath(g, "spectral.brightness_rank", 2) or 2
    ceiling = 4000.0 + (3 - rank) * 600.0  # placeholder, brighter genres tolerate more
    if not (centroid > ceiling and air > -50.0):
        return None
    return _problem(
        track_id=_track_id(a), slug="thin_and_bright", severity="moderate", confidence=0.88,
        category="frequency_balance", kind="fault", suspected=False,
        headline="Thin and bright - tonal balance tilted off the low end",
        summary=f"Weak low end with a hot top (centroid {centroid:.0f} Hz over {ceiling:.0f}, "
                "air elevated) is one tilt to correct, not three faults. Placeholder thresholds.",
        evidence=[
            Evidence(metric="phase1.spectral_centroid_hz", value=float(centroid),
                     expected_range=(1500.0, ceiling), label=f"centroid {centroid:.0f} Hz"),
            Evidence(metric="phase1.bands.air", value=float(air),
                     frequency_range_hz=(8000.0, 22000.0), label="air hot"),
        ],
        why_it_matters="A low-tilt EQ (shelve the top, lift the lows) rebalances the whole "
                       "mix in one move.",
    )


@composite("lost_transients", suppresses=["weak_transients", "over_compression"])
def lost_transients(a: dict[str, Any], fired: dict[str, Verdict]) -> Verdict | None:
    """C - weak transients corroborated by a crushed crest factor: the punch was
    limited/compressed away, not merely soft. Audio-only analogue of the MIDI-only
    `lifeless_at_source`. Uses the same genre-aware crest gate as `loudness_war`,
    so techno's inherently low crest gates it out. De-suspected by corroboration."""
    if "weak_transients" not in fired:
        return None
    p1 = _phase(a, "phase1")
    avg = (p1.get("transients") or {}).get("avg_transient_strength")
    cf = p1.get("crest_factor")
    if avg is None or cf is None:
        return None
    g = _genre(a)
    crest_warn = G.ppath(g, "dynamics.crest_db.warn_below", 6.0)
    if cf >= crest_warn:
        return None  # crest healthy (or inherent-low for techno) - not "lost"
    ideal = G.ppath(g, "dynamics.crest_db.range", [7.0, 12.0])
    return _problem(
        track_id=_track_id(a), slug="lost_transients", severity="moderate", confidence=0.9,
        category="dynamics", kind="fault", suspected=False, fixable=False,
        headline="Lost transients - punch limited away",
        summary=f"Weak onset strength ({avg:.2f}) with a crushed crest ({cf:.1f} dB) - the "
                "transients were compressed/limited out, not just soft in the parts.",
        evidence=[
            Evidence(metric="phase1.transients.avg_transient_strength", value=float(avg),
                     label="weak attack"),
            Evidence(metric="phase1.crest_factor", value=float(cf),
                     expected_range=tuple(ideal), label=f"{cf:.1f} dB crest"),
        ],
        why_it_matters="Weak transients plus a crushed crest mean the punch was limited away - "
                       "address the master/bus dynamics chain, not one EQ move.",
    )


# ── TIER S / P — stem + MIDI problems. Data-tier tagged; gated on presence ────
# S rules need phase4.stems.status == "ok"; P rules need a non-empty phase8.
# Never grade missing data — absent tier returns None.

_BAND_HZ: dict[str, tuple[float, float]] = {
    "sub": (20.0, 60.0), "sub_bass": (20.0, 60.0), "bass": (60.0, 200.0),
    "low_mid": (200.0, 500.0), "mid": (500.0, 2000.0), "upper_mid": (2000.0, 5000.0),
    "presence": (5000.0, 8000.0), "air": (8000.0, 20000.0),
}
_TIER_SEV: dict[str, Severity] = {"critical": "severe", "warning": "moderate"}


def _stems_block(a: dict[str, Any]) -> dict[str, Any] | None:
    """phase4.stems iff it was actually analyzed (status == 'ok'), else None."""
    stems = _phase(a, "phase4").get("stems") or {}
    return stems if stems.get("status") == "ok" else None


@single("stem_clash", tier="S")
def stem_clash(a: dict[str, Any]) -> Verdict | None:
    stems = _stems_block(a)
    if stems is None:
        return None
    worst: dict[str, Any] | None = None
    for row in stems.get("clash_matrix") or []:
        tier = row.get("severity_tier")
        if tier in ("warning", "critical") and (worst is None or tier == "critical"):
            worst = row
    if worst is None:
        return None
    sev = _TIER_SEV.get(worst.get("severity_tier", "warning"), "moderate")
    a_s, b_s, band = worst.get("stem_a"), worst.get("stem_b"), worst.get("band")
    return _problem(
        track_id=_track_id(a), slug="stem_clash", severity=sev,
        category="frequency_collision", kind="fault", data_tier="stems",
        headline=f"Stem clash: {a_s} vs {b_s} ({band})",
        summary=f"{a_s} and {b_s} overlap in the {band} band - masking that a fix should carve.",
        evidence=[Evidence(metric="phase4.stems.clash_matrix", value=None,
                           label=f"{a_s} x {b_s} {band}", stems=[a_s, b_s],
                           frequency_range_hz=_BAND_HZ.get(band or ""))],
        why_it_matters="Two stems competing in one band smear definition; carve one to make room.",
    )


@single("stem_balance", tier="S")
def stem_balance(a: dict[str, Any]) -> Verdict | None:
    stems = _stems_block(a)
    if stems is None:
        return None
    worst_role: str | None = None
    worst_sev: Severity | None = None
    for role, flag in (stems.get("per_stem") or {}).items():
        sev = _TIER_SEV.get((flag or {}).get("severity_tier") or "")
        if sev is None:
            continue
        if worst_sev is None or sev == "severe":
            worst_role, worst_sev = role, sev
    if worst_role is None or worst_sev is None:
        return None
    direction = ((stems.get("per_stem") or {}).get(worst_role) or {}).get("direction", "off")
    return _problem(
        track_id=_track_id(a), slug="stem_balance", severity=worst_sev,
        category="gain_staging", kind="fault", data_tier="stems",
        headline=f"Stem balance: {worst_role} is {direction}",
        summary=f"The {worst_role} stem sits {direction} relative to the rest of the mix.",
        evidence=[Evidence(metric="phase4.stems.per_stem", value=None,
                           label=f"{worst_role} {direction}", stems=[worst_role])],
        why_it_matters="A mis-balanced stem skews the whole mix; re-gain it before mastering.",
    )


def _vel_severity(vstd: float | None, hscore: Any) -> Severity | None:
    if vstd is not None and vstd == 0:
        return "critical"
    if vstd is not None and vstd < 3:
        return "severe"
    if hscore == "robotic":
        return "severe"
    return None


@single("robotic_velocity", tier="P")
def robotic_velocity(a: dict[str, Any]) -> Verdict | None:
    p8 = _phase(a, "phase8")
    if not p8:
        return None
    rank: dict[Severity, int] = {"critical": 4, "severe": 3, "moderate": 2, "minor": 1, "win": 0}
    worst_name: str | None = None
    worst_sev: Severity | None = None
    worst_vstd: float | None = None
    for name, t in (p8.get("per_track_analysis") or {}).items():
        vstd = t.get("velocity_std")
        sev = _vel_severity(vstd, t.get("humanization_score"))
        if sev is None:
            continue
        if worst_sev is None or rank[sev] > rank[worst_sev]:
            worst_name, worst_sev, worst_vstd = name, sev, vstd
    if worst_name is None or worst_sev is None:
        return None
    if "." not in worst_name and worst_vstd is not None:
        ev = Evidence(metric=f"phase8.per_track_analysis.{worst_name}.velocity_std",
                      value=float(worst_vstd), label=f"{worst_name} velocity std {worst_vstd:.1f}")
    else:
        ev = Evidence(metric="phase8.per_track_analysis", value=None,
                      label=f"{worst_name} robotic")
    return _problem(
        track_id=_track_id(a), slug="robotic_velocity", severity=worst_sev,
        category="humanization", kind="fault", data_tier="project_midi",
        where={"track_names": [worst_name]},  # FR12: attribute to the named project track
        headline=f"Robotic velocities ({worst_name})",
        summary=f"{worst_name} has near-zero velocity variation - notes are machine-flat, not played.",
        evidence=[ev],
        why_it_matters="Identical velocities read as programmed; humanizing adds groove and life.",
    )


@single("no_headroom", tier="P")
def no_headroom(a: dict[str, Any]) -> Verdict | None:
    p8 = _phase(a, "phase8")
    if not p8:
        return None
    vols = [t.get("volume_db") for t in (p8.get("tracks") or [])
            if not t.get("muted") and t.get("volume_db") is not None]
    if not vols:
        return None
    pct_high = sum(1 for v in vols if v > -1.0) / len(vols)
    mean = sum(vols) / len(vols)
    std = (sum((v - mean) ** 2 for v in vols) / len(vols)) ** 0.5 if len(vols) >= 2 else None
    if not (pct_high > 0.8 or (std is not None and std < 2.0)):
        return None
    return _problem(
        track_id=_track_id(a), slug="no_headroom", severity="moderate",
        category="gain_staging", kind="fault", data_tier="project_midi",
        headline="No mix headroom - faders pinned",
        summary="Most unmuted tracks sit near 0 dB with no gain-staging spread; "
                "the master bus has no room to breathe.",
        evidence=[Evidence(metric="phase8.tracks", value=None,
                           label=f"{pct_high * 100:.0f}% of faders near unity")],
        why_it_matters="Pinned faders pile gain onto the master; pull tracks down to leave headroom.",
    )


@single("quantization_issues", tier="P")
def quantization_issues(a: dict[str, Any]) -> Verdict | None:
    p8 = _phase(a, "phase8")
    if not p8:
        return None
    n = int(p8.get("quantization_issues_count") or 0)
    if n < 1:
        return None
    sev: Severity = "severe" if n > 20 else "moderate"
    return _problem(
        track_id=_track_id(a), slug="quantization_issues", severity=sev,
        category="humanization", kind="fault", data_tier="project_midi",
        headline=f"Quantization issues ({n})",
        summary=f"{n} notes sit off-grid in a way that reads as timing error, not groove.",
        evidence=[Evidence(metric="phase8.quantization_issues_count", value=float(n),
                           label=f"{n} off-grid notes")],
        why_it_matters="Sloppy timing muddies transients; quantize or nudge the worst offenders.",
    )


@single("project_clutter", tier="P")
def project_clutter(a: dict[str, Any]) -> Verdict | None:
    p8 = _phase(a, "phase8")
    if not p8:
        return None
    pct = p8.get("clutter_pct")
    if pct is None or pct <= 0.3:
        return None
    sev: Severity = "moderate" if pct > 0.5 else "minor"
    disabled = int(p8.get("disabled_devices") or 0)
    return _problem(
        track_id=_track_id(a), slug="project_clutter", severity=sev,
        category="device_chain", kind="observation", data_tier="project_midi", suspected=True,
        headline=f"Project clutter ({pct * 100:.0f}% disabled)",
        summary=f"{pct * 100:.0f}% of devices ({disabled} of them) are disabled - the project "
                "carries dead weight that obscures the live signal chain.",
        evidence=[Evidence(metric="phase8.clutter_pct", value=float(pct),
                           label=f"{disabled} disabled devices")],
        why_it_matters="A cluttered project is hard to reason about; prune disabled devices to "
                       "clarify the chain.",
    )
