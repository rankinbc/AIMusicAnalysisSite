"""Public types for the stems module. Consumed by phases, verdict pipeline, and API."""
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Literal


class StemRole(StrEnum):
    DRUMS = "drums"
    KICK = "kick"
    SNARE = "snare"
    HATS = "hats"
    BASS = "bass"
    VOCALS = "vocals"
    LEAD = "lead"
    PAD = "pad"
    FX = "fx"
    OTHER = "other"


class FreqBand(StrEnum):
    SUB = "sub"
    BASS = "bass"
    LOW_MID = "low_mid"
    MID = "mid"
    HIGH_MID = "high_mid"
    PRESENCE = "presence"
    AIR = "air"


BAND_EDGES_HZ: dict[FreqBand, tuple[float, float]] = {
    FreqBand.SUB: (20.0, 60.0),
    FreqBand.BASS: (60.0, 200.0),
    FreqBand.LOW_MID: (200.0, 600.0),
    FreqBand.MID: (600.0, 2000.0),
    FreqBand.HIGH_MID: (2000.0, 6000.0),
    FreqBand.PRESENCE: (6000.0, 12000.0),
    FreqBand.AIR: (12000.0, 20000.0),
}


SeverityTier = Literal["info", "warning", "critical"]


@dataclass(frozen=True)
class RoleProposal:
    role: StemRole
    confidence: float
    evidence: str


@dataclass
class StemMappingProposal:
    file: Path
    proposed_role: StemRole
    proposed_als_track: str | None
    confidence: float


@dataclass
class ConfirmedMapping:
    file: Path
    role: StemRole
    als_track: str | None


@dataclass
class StemMetrics:
    role: StemRole
    duration_s: float
    peak_db: float
    rms_db: float
    lufs_integrated: float
    dynamic_range_db: float
    band_energy_db: dict[FreqBand, float]
    spectral_centroid_hz: float
    dominant_frequencies_hz: list[float]
    stereo_width: float
    pan_estimate: float
    is_mono: bool


@dataclass
class StemClash:
    stem_a: StemRole
    stem_b: StemRole
    band: FreqBand
    overlap_severity: float
    severity_tier: SeverityTier


@dataclass
class BalanceFlag:
    role: StemRole
    metric: str
    observed: float
    expected_range: tuple[float, float]
    direction: Literal["too_low", "too_high"]
    severity_tier: SeverityTier


@dataclass
class StemAnalysisResult:
    per_stem: dict[StemRole, StemMetrics]
    clash_matrix: list[StemClash] = field(default_factory=list)
    balance_flags: list[BalanceFlag] = field(default_factory=list)


@dataclass
class StemReferenceDelta:
    role: StemRole
    metric: str
    user_value: float
    reference_value: float
    delta: float
    interpretation: str
    severity_tier: SeverityTier
