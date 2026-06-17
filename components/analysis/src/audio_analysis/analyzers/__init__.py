"""Self-contained DSP analyzers vendored from AbletonAIAnalysis.

Each analyzer takes a ``(channels, samples)`` (or 1-D mono) numpy array plus a
sample rate and returns a dataclass — no coupling to the rest of the pipeline,
no heavy deps (librosa + numpy only).
"""

from .spatial_analyzer import (
    PlaybackInfo,
    SpatialAnalyzer,
    SpatialInfo,
    SurroundInfo,
)

__all__ = [
    "SpatialAnalyzer",
    "SpatialInfo",
    "SurroundInfo",
    "PlaybackInfo",
]
