"""Teach-mode knowledge base: curated teaching units + deterministic selection.

Public API used by the coach actor:
- ``load_units()`` — load + validate the ``units/*.md`` knowledge base (cached).
- ``select_units(question, verdicts, units)`` — pick ≤3 relevant units + catalog.
- ``TeachingUnit`` — the unit dataclass.
"""
from __future__ import annotations

from .loader import TeachingUnitError, clear_units_cache, load_units, parse_unit
from .models import TeachingUnit
from .selector import select_units

__all__ = [
    "TeachingUnit",
    "TeachingUnitError",
    "load_units",
    "parse_unit",
    "clear_units_cache",
    "select_units",
]
