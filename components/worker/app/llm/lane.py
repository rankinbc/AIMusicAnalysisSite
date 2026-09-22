"""Which LLM budget lane a call rides. Guests (users.is_guest) get their own lane so
demo traffic can never exhaust the budget real users depend on. Fail-open: any lookup
problem keeps the caller's default tier — exactly the pre-lane behaviour."""
from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

GUEST_TIER = "guest"
_TTL_S = 60.0
_MAX = 2048
_cache: dict[str, tuple[float, bool]] = {}


def reset_lane_cache() -> None:
    _cache.clear()


def _lookup_is_guest(user_id: Any) -> bool | None:
    """Return ``is_guest`` for ``user_id`` — or ``None`` when NO row matches.

    ``users.is_guest`` is NOT NULL, so a bare ``None`` from ``.scalar()`` is
    unambiguous for "no such row" (an account purged while its work was still
    queued — see M7 in ``resolve_lane`` below), never confusable with a live
    ``is_guest=false`` row.
    """
    from sqlalchemy import text  # noqa: PLC0415 — lazy: keeps the gateway import DB-free

    from app.db_sync import SessionFactory, uid_param  # noqa: PLC0415
    with SessionFactory() as s:
        # uid_param normalizes per dialect — psycopg2 adapts uuid.UUID
        # natively (Postgres, unchanged behaviour); sqlite (unit tests)
        # stores the ORM's 32-hex form and needs the .hex string instead
        # (same helper account_deletion_actor.purge_account_data uses).
        value = s.execute(
            text("SELECT is_guest FROM users WHERE id = :id"),
            {"id": uid_param(s, user_id)},
        ).scalar()
        return None if value is None else bool(value)


def resolve_lane(user_id: Any | None, default: str | None) -> str | None:
    if user_id is None:
        return default
    key, now = str(user_id), time.monotonic()
    hit = _cache.get(key)
    if hit is None or now - hit[0] > _TTL_S:
        try:
            is_guest = _lookup_is_guest(user_id)
        except Exception:
            logger.exception("lane lookup failed for %s — keeping tier=%s", key, default)
            return default
        # M7 — a purged account (no row) rides the guest lane: work queued
        # before the guest was purged must never bill the real-user free/pro
        # lane or count toward its global spend sum. Cached the same as a
        # live-guest hit, so a purge-then-immediate-requeue race can still
        # serve a stale read for up to the 60s TTL — accepted (see the module
        # docstring's fail-open framing; a stale GUEST read only ever narrows
        # spend, never inflates the real-user sum).
        hit = (now, True if is_guest is None else is_guest)
        if len(_cache) >= _MAX:
            _cache.clear()
        _cache[key] = hit
    return GUEST_TIER if hit[1] else default
