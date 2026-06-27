"""Teach-mode data model (story: teach-mode-coach).

A ``TeachingUnit`` is one curated lesson distilled from the
``docs/research/teach/`` craft references. It carries the plain-voice lesson
body plus the structured metadata the selector + prompt need: the rule-engine
``category`` it teaches, the question ``aliases`` that trigger it, and the
``reference_paths`` (real analysis paths) the coach should anchor the lesson to.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TeachingUnit:
    """One curated teaching unit. Immutable; loaded once from a ``units/*.md``
    file by :func:`app.coach_lib.teach.loader.load_units`.
    """

    slug: str
    category: str                      # rule-engine vocabulary (frequency_balance, …)
    aliases: tuple[str, ...]           # lowercased question trigger terms
    reference_paths: tuple[str, ...]   # real bundle paths (e.g. phase1.bands.low_mid)
    title: str                         # human title for the catalog
    body: str                          # the plain-voice lesson markdown
