"""Structure detection result dataclasses.

Stdlib-only ports of the dataclasses needed by ArrangementScorer.
The full StructureDetector is *not* ported — Phase 1 already runs
all_in_one_fix and provides a structure dict; ``phase1_adapter`` converts
that dict into a typed StructureResult here.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional


class SectionType(Enum):
    """Trance-specific section types."""
    INTRO = "intro"
    BUILDUP = "buildup"
    DROP = "drop"
    BREAKDOWN = "breakdown"
    OUTRO = "outro"
    UNKNOWN = "unknown"


@dataclass
class Section:
    """A detected song section."""
    section_type: SectionType
    start_time: float           # seconds
    end_time: float             # seconds
    duration_seconds: float
    duration_bars: int          # estimated bars based on tempo
    confidence: float           # 0-1 detection confidence
    original_label: str         # original label from detector (before mapping)

    @property
    def time_range_formatted(self) -> str:
        """Format time range as MM:SS-MM:SS."""
        start_mins = int(self.start_time // 60)
        start_secs = int(self.start_time % 60)
        end_mins = int(self.end_time // 60)
        end_secs = int(self.end_time % 60)
        return f"{start_mins}:{start_secs:02d}-{end_mins}:{end_secs:02d}"


@dataclass
class StructureResult:
    """Complete structure detection result."""
    success: bool
    detection_method: str       # 'all_in_one_fix', 'librosa_novelty', etc.
    confidence: float           # overall confidence (0-1)

    # Tempo and rhythm
    tempo_bpm: float
    beats: List[float]          # beat times in seconds (may be empty for adapter mode)
    downbeats: List[float]      # downbeat times in seconds (may be empty)

    # Sections
    sections: List[Section]
    section_count: int

    # Track info
    duration_seconds: float
    total_bars: int

    # Error info
    error_message: Optional[str] = None

    def get_sections_by_type(self, section_type: SectionType) -> List[Section]:
        """Get all sections of a specific type."""
        return [s for s in self.sections if s.section_type == section_type]
