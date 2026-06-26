"""Genre-config loader for the Problem rule engine.

Reads the two committed config files in ``config/``:
  - ``genre-profiles.json`` — per-genre reference values + ``_platform_targets``
  - ``rule-bindings.json``  — ``genre_map``, ``master_context``, per-rule bindings

Rules call these accessors to pull genre-relative numbers by dotted path; the
engine never hardcodes a threshold. ``genre-config.md`` is the human-readable
spec companion (not loaded). Never raises on a missing genre — falls back via
``genre_map.default``.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_DIR = Path(__file__).with_name("config")


@lru_cache(maxsize=1)
def _profiles() -> dict[str, Any]:
    return json.loads((_DIR / "genre-profiles.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _bindings() -> dict[str, Any]:
    return json.loads((_DIR / "rule-bindings.json").read_text(encoding="utf-8"))


def resolve_genre(phase2_genre: str | None) -> str:
    """Map ``phase2.genre`` (dnb/trance/house/techno/other) to a profile key."""
    gm = _bindings()["genre_map"]
    return gm.get((phase2_genre or "").lower(), gm["default"])


def profile(phase2_genre: str | None) -> dict[str, Any]:
    return _profiles()["genre_profiles"][resolve_genre(phase2_genre)]


def ppath(phase2_genre: str | None, dotted: str, default: Any = None) -> Any:
    """Read a dotted path inside the resolved genre profile (e.g.
    ``"loudness.club.lufs_target"``). Returns *default* if any segment is absent."""
    node: Any = profile(phase2_genre)
    for part in dotted.split("."):
        if not isinstance(node, dict) or part not in node:
            return default
        node = node[part]
    return node


def platform(key: str, default: Any = None) -> Any:
    """Read a cross-genre value from ``_platform_targets``."""
    return _profiles()["_platform_targets"].get(key, default)


def master_context() -> str:
    """The loudness world to judge against — ``"streaming"`` (default) or ``"club"``."""
    return _bindings()["master_context"]["default"]


def binding(rule_id: str) -> dict[str, Any]:
    """The ``rule-bindings.json::bindings`` entry for a rule (its predicate spec)."""
    return _bindings()["bindings"].get(rule_id, {})
