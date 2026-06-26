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

from app.verdict_lib import genre_config as G
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
