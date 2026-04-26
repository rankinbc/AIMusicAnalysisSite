"""Per-stem metric deltas: user vs. reference. Pure number-crunching, no IO."""
from .types import (
    SeverityTier, StemAnalysisResult, StemReferenceDelta, StemRole,
)


METRIC_THRESHOLDS: dict[str, dict[str, float]] = {
    "rms_db": {"info": 1.0, "warning": 3.0, "critical": 6.0},
    "lufs_integrated": {"info": 1.0, "warning": 3.0, "critical": 6.0},
    "stereo_width": {"info": 0.1, "warning": 0.25, "critical": 0.5},
}


def _severity(metric: str, abs_delta: float) -> SeverityTier:
    base = metric.split(".")[0]
    th = METRIC_THRESHOLDS.get(base, {"info": 0.0, "warning": 0.0, "critical": 0.0})
    if abs_delta >= th["critical"]:
        return "critical"
    if abs_delta >= th["warning"]:
        return "warning"
    return "info"


def _interpret(metric: str, delta: float) -> str:
    direction = {
        "rms_db": ("louder", "quieter"),
        "lufs_integrated": ("louder (LUFS)", "quieter (LUFS)"),
        "stereo_width": ("wider", "narrower"),
    }.get(metric.split(".")[0], ("higher", "lower"))
    word = direction[0] if delta > 0 else direction[1]
    unit = "dB" if "db" in metric.lower() or "lufs" in metric else ""
    return f"{abs(delta):.1f} {unit} {word} than reference".strip()


def _delta_for_metric(
    role: StemRole, metric: str, user_value: float, reference_value: float,
) -> StemReferenceDelta:
    delta = user_value - reference_value
    return StemReferenceDelta(
        role=role, metric=metric,
        user_value=user_value, reference_value=reference_value,
        delta=delta,
        interpretation=_interpret(metric, delta),
        severity_tier=_severity(metric, abs(delta)),
    )


def compare(user: StemAnalysisResult, reference: StemAnalysisResult) -> list[StemReferenceDelta]:
    """Return per-role, per-metric deltas. Skips roles missing in either side."""
    out: list[StemReferenceDelta] = []
    for role, u in user.per_stem.items():
        r = reference.per_stem.get(role)
        if r is None:
            continue
        out.append(_delta_for_metric(role, "rms_db", u.rms_db, r.rms_db))
        out.append(_delta_for_metric(role, "lufs_integrated", u.lufs_integrated, r.lufs_integrated))
        out.append(_delta_for_metric(role, "stereo_width", u.stereo_width, r.stereo_width))
        for band, u_db in u.band_energy_db.items():
            r_db = r.band_energy_db.get(band)
            if r_db is None:
                continue
            out.append(_delta_for_metric(role, f"band_energy_db.{band.value}", u_db, r_db))
    return out
