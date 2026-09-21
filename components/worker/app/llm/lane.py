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


def _lookup_is_guest(user_id: Any) -> bool:
    from sqlalchemy import text  # noqa: PLC0415 — lazy: keeps the gateway import DB-free

    from app.db_sync import SessionFactory, uid_param  # noqa: PLC0415
    with SessionFactory() as s:
        # uid_param normalizes per dialect — psycopg2 adapts uuid.UUID
        # natively (Postgres, unchanged behaviour); sqlite (unit tests)
        # stores the ORM's 32-hex form and needs the .hex string instead
        # (same helper account_deletion_actor.purge_account_data uses).
        return bool(s.execute(
            text("SELECT is_guest FROM users WHERE id = :id"),
            {"id": uid_param(s, user_id)},
        ).scalar())


def resolve_lane(user_id: Any | None, default: str | None) -> str | None:
    if user_id is None:
        return default
    key, now = str(user_id), time.monotonic()
    hit = _cache.get(key)
    if hit is None or now - hit[0] > _TTL_S:
        try:
            hit = (now, _lookup_is_guest(user_id))
        except Exception:
            logger.exception("lane lookup failed for %s — keeping tier=%s", key, default)
            return default
        if len(_cache) >= _MAX:
            _cache.clear()
        _cache[key] = hit
    return GUEST_TIER if hit[1] else default
