"""Worker-side feature_flags reader (AR35 / story 2.6).

The BFF and worker share a single ``feature_flags`` table. The BFF reads it via
``EntitlementService.GetFlagsAsync`` (60 s ``IMemoryCache``); this is the worker's
equivalent: one cached snapshot of the whole table, 60 s TTL, fail-open. An
operator changing a cap value is therefore picked up by BOTH services within the
cache window with no redeploy.

The worker consumes these flags for the SPEND guard's per-tier monthly USD
ceilings (see ``app.llm.budget``) — the gateway half of the two-guard model. It
does NOT read the coach message-COUNT caps; that gate lives in the BFF.

Design notes:
* SQLAlchemy Core ``text()`` against the worker's sync ``SessionFactory`` — no new
  ORM model in ``aimusic_shared`` (avoids migration coupling; the BFF owns the
  schema via EF Core).
* Fail-open: any error (table missing in a unit-test sqlite DB, DB down, …) keeps
  the last good snapshot, or an empty dict on cold start, so callers fall back to
  their env defaults rather than crashing the LLM path.
* ``_now`` is injectable so tests can drive the TTL clock deterministically.
"""
from __future__ import annotations

import logging
import time
from decimal import Decimal, InvalidOperation

logger = logging.getLogger(__name__)

_TTL_S = 60.0

# Monotonic clock indirection — overridable in tests.
_now = time.monotonic

# Module-level cache (workers run concurrency=1, so a plain dict is safe).
_cache: dict[str, str] = {}
_loaded_at: float | None = None


def _load() -> dict[str, str]:
    """Read the whole feature_flags table. Lazy imports keep this module cheap
    to import and avoid binding a DB engine at import time."""
    from sqlalchemy import text  # noqa: PLC0415 — deliberate lazy import

    from app.db_sync import SessionFactory  # noqa: PLC0415

    with SessionFactory() as s:
        rows = s.execute(text("SELECT name, value FROM feature_flags")).all()
    return {str(name): str(value) for name, value in rows}


def get_flags(*, force: bool = False) -> dict[str, str]:
    """Return the cached flag snapshot, refreshing if older than the TTL.

    Fail-open: on a load error we keep the previous snapshot (or ``{}`` on cold
    start) and stamp ``_loaded_at`` so we don't hammer a sick DB every call
    inside the TTL window.
    """
    global _cache, _loaded_at
    now = _now()
    if not force and _loaded_at is not None and (now - _loaded_at) < _TTL_S:
        return _cache
    try:
        _cache = _load()
        _loaded_at = now
    except Exception:
        logger.warning(
            "feature_flags load failed — falling back to last/empty snapshot",
            exc_info=True,
        )
        _loaded_at = now  # avoid hammering a sick DB within the TTL window
    return _cache


def get_flag_decimal(name: str, default: Decimal | None) -> Decimal | None:
    """Resolve a flag as ``Decimal``. Returns ``default`` on miss/parse failure.

    Callers must None-check (not truthiness-check) so an operator can set a
    ceiling of ``0`` to hard-stop a tier.
    """
    raw = get_flags().get(name)
    if raw is None:
        return default
    try:
        return Decimal(raw)
    except (InvalidOperation, ValueError):
        return default


def get_flag_int(name: str, default: int) -> int:
    """Resolve a flag as ``int``. Returns ``default`` on miss/parse failure."""
    raw = get_flags().get(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def reset_cache() -> None:
    """Test helper — drop the cached snapshot so the next read re-loads."""
    global _cache, _loaded_at
    _cache = {}
    _loaded_at = None
