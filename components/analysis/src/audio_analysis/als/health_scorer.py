from dataclasses import dataclass, field
from typing import List
from audio_analysis.als.als_parser import ALSProject


@dataclass
class TrackSummary:
    name: str
    track_type: str
    device_count: int
    disabled_count: int
    muted: bool
    devices: List[str] = field(default_factory=list)


@dataclass
class HealthResult:
    score: int           # 0-100
    grade: str           # A-F
    total_devices: int
    disabled_devices: int
    clutter_pct: float
    track_summaries: List[TrackSummary] = field(default_factory=list)


def _get_grade(score: int) -> str:
    if score >= 80: return "A"
    if score >= 60: return "B"
    if score >= 40: return "C"
    if score >= 20: return "D"
    return "F"


def score_health(project: ALSProject) -> HealthResult:
    total_devices = 0
    disabled_devices = 0
    track_summaries: List[TrackSummary] = []

    for track in project.tracks:
        device_count = len(track.devices)
        disabled_count = 0
        total_devices += device_count
        disabled_devices += disabled_count

        track_summaries.append(TrackSummary(
            name=track.name,
            track_type=track.track_type,
            device_count=device_count,
            disabled_count=disabled_count,
            muted=track.is_muted,
            devices=list(track.devices),
        ))

    clutter_pct = (disabled_devices / total_devices * 100) if total_devices > 0 else 0.0

    score = 100
    if clutter_pct > 30:
        score -= 10
    elif clutter_pct > 20:
        score -= 5
    muted_tracks = sum(1 for t in project.tracks if t.is_muted)
    score -= min(muted_tracks * 3, 15)
    score = max(0, min(100, score))

    return HealthResult(
        score=score,
        grade=_get_grade(score),
        total_devices=total_devices,
        disabled_devices=disabled_devices,
        clutter_pct=round(clutter_pct, 1),
        track_summaries=track_summaries,
    )
