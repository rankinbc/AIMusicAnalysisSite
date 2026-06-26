"""Genre-corpus tuner — measure a folder of pro reference tracks through the SAME
phase1 DSP the rule engine reads, aggregate per genre (median / p10 / p90), and
propose ``genre-profiles.json`` threshold updates that replace the ``suspected`` /
``interpolation`` placeholders with measured values.

Run: ``python -m app.tools.genre_corpus <reference_dir> [--out report.json] [--write]``
"""
from __future__ import annotations

from .measure import measure_track
from .propose import propose_updates
from .stats import Summary, aggregate, summarize

__all__ = ["measure_track", "propose_updates", "Summary", "aggregate", "summarize"]
