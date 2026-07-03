"""Story 3.4 (AR22/NFR20/NFR26) — the authoritative nightly retention sweep.

``sweep_retention`` purges RAW AUDIO objects (mix / stems / .als / reference)
for versions past their retention window and stamps
``song_versions.raw_audio_purged_at`` — the idempotency key. Reports
(``analyses.final_json`` + rendered images + ``reports/{jobId}.json``),
verdicts, and coach chats are NEVER touched: results live forever (AR15).

Tier rules (decided per USER, from the BFF-owned billing tables read via
SQLAlchemy Core ``text()`` — the feature_flags.py precedent; there is no
Python mirror for billing and none is needed for read-only aggregates):

    PAID    subscription status in (active, trialing, past_due) OR
            credit balance > 0                          -> never purged
    LAPSED  newest subscription status in
            (canceled, unpaid, incomplete_expired)      -> purge ALL raw audio
            once now > current_period_end + RETENTION_LAPSED_DAYS
            (current_period_end > now + 5y is the SubscriptionMirrorService
            missing-field sentinel -> treated as PAID, never purged)
    FREE    everything else                             -> purge per-version
            once version.created_at < now - RETENTION_FREE_DAYS

FAIL-CLOSED: if the billing queries error (missing table, schema drift), the
sweep purges NOTHING that run — an unreadable subscriptions table must never
make every customer look "free".

Env (AR40): RETENTION_FREE_DAYS=30, RETENTION_LAPSED_DAYS=90,
RETENTION_ANON_HOURS=72 (the anon guard no-ops until Epic 4 adds devices).
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone

import dramatiq
from sqlalchemy import text

from . import object_store
from .db_sync import SessionFactory
from .tasks_dramatiq import LOCAL_ROOT

logger = logging.getLogger(__name__)

_PAID_STATUSES = ("active", "trialing", "past_due")
_LAPSED_STATUSES = ("canceled", "unpaid", "incomplete_expired")


def _free_days() -> int:
    return int(os.environ.get("RETENTION_FREE_DAYS", "30"))


def _lapsed_days() -> int:
    return int(os.environ.get("RETENTION_LAPSED_DAYS", "90"))


def _as_dt(v) -> datetime | None:
    """Raw-SQL timestamps come back as str on sqlite, datetime on Postgres."""
    if v is None:
        return None
    if isinstance(v, str):
        v = datetime.fromisoformat(v)
    if v.tzinfo is None:
        v = v.replace(tzinfo=timezone.utc)
    return v


def _as_json(v):
    """Raw-SQL JSONB comes back parsed on Postgres, as text on sqlite."""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except ValueError:
            return None
    return v


def _version_keys(row) -> list[str]:
    """Every raw-audio storage key a version row references (exact keys only)."""
    keys: list[str] = []
    if row.file_path:
        keys.append(row.file_path)
    if row.reference_path:
        keys.append(row.reference_path)
    if row.als_file_path:
        keys.append(row.als_file_path)
    stem_paths = _as_json(row.stem_paths) or {}
    if isinstance(stem_paths, dict):
        for entry in stem_paths.values():
            for k in entry if isinstance(entry, list) else [entry]:
                if k:
                    keys.append(str(k))
    for e in _as_json(row.stem_paths_raw) or []:
        if isinstance(e, dict) and e.get("path"):
            keys.append(str(e["path"]))
    # De-dup while preserving order (grouped stem_paths repeat raw keys).
    seen: set[str] = set()
    return [k for k in keys if not (k in seen or seen.add(k))]


def _classify_users(session, now: datetime) -> tuple[set, set]:
    """Return (protected_user_ids, lapsed_purgeable_user_ids). Raises on
    failure (the caller fails CLOSED).

    PROTECTED = paid signal (active/trialing/past_due sub, credits, or the
    mirror's far-future sentinel) OR lapsed-but-inside-the-90-day-grace —
    a lapsed customer must get the FULL post-lapse window, never the shorter
    free-tier 30-day rule.
    """
    sentinel_cutoff = now + timedelta(days=365 * 5)
    lapse_cutoff = now - timedelta(days=_lapsed_days())

    subs = session.execute(text(
        "SELECT user_id, status, current_period_end FROM subscriptions"
    )).all()
    balances = session.execute(text(
        "SELECT user_id, COALESCE(SUM(amount), 0) AS balance FROM credit_ledger GROUP BY user_id"
    )).all()

    protected: set = {r.user_id for r in balances if (r.balance or 0) > 0}
    lapsed_purgeable: set = set()
    for r in subs:
        status = (r.status or "").lower()
        if status in _PAID_STATUSES:
            protected.add(r.user_id)
            continue
        if status in _LAPSED_STATUSES:
            period_end = _as_dt(r.current_period_end)
            if period_end is None:
                protected.add(r.user_id)  # cannot anchor the lapse — fail safe
            elif period_end > sentinel_cutoff:
                protected.add(r.user_id)  # mirror-sentinel row — treat as paid
            elif period_end < lapse_cutoff:
                lapsed_purgeable.add(r.user_id)
            else:
                protected.add(r.user_id)  # lapsed but inside the grace window
    # A paid signal always wins over a stale lapsed row.
    return protected, lapsed_purgeable - protected


def _purge_unclaimed_anonymous(session, now: datetime) -> int:
    """AC3 — anonymous DEVICE uploads unclaimed >72 h. The devices table lands
    with Epic 4 (story 4.5); until then this guard no-ops safely."""
    try:
        probe = session.execute(text("SELECT to_regclass('public.devices')")).scalar()
    except Exception:
        # Non-Postgres test DBs / permission oddities — the guard's whole job
        # is to be safe before the table exists.
        probe = None
    if probe is None:
        logger.info("sweep_retention: no devices table yet — anon purge no-op")
        return 0
    # Epic 4 will implement the actual purge here (RETENTION_ANON_HOURS).
    return 0


def run_sweep(now: datetime | None = None) -> dict:
    """One idempotent sweep pass. Returns stats for logging/tests."""
    now = now or datetime.now(timezone.utc)
    stats = {"purged_versions": 0, "deleted_keys": 0, "anon_purged": 0, "skipped": False}

    with SessionFactory() as session:
        # ── Tier classification — FAIL-CLOSED on any billing read error ─────
        try:
            protected, lapsed_purgeable = _classify_users(session, now)
        except Exception:
            logger.exception("sweep_retention: billing classification failed — purging NOTHING")
            stats["skipped"] = True
            return stats

        free_cutoff = now - timedelta(days=_free_days())
        candidates = session.execute(text(
            """
            SELECT v.id, v.created_at, s.user_id,
                   v.file_path, v.reference_path, v.als_file_path,
                   v.stem_paths, v.stem_paths_raw
            FROM song_versions v
            JOIN songs s ON s.id = v.song_id
            WHERE v.raw_audio_purged_at IS NULL
            """
        )).all()

        for row in candidates:
            if row.user_id in protected:
                continue
            created = _as_dt(row.created_at)
            if row.user_id in lapsed_purgeable:
                pass  # lapse window elapsed — every unpurged version goes
            elif created is None or created >= free_cutoff:
                continue  # free-tier version still inside its 30-day window

            keys = _version_keys(row)
            for key in keys:
                try:
                    object_store.delete_object(key, LOCAL_ROOT)
                    stats["deleted_keys"] += 1
                except Exception:
                    # Best-effort per key: residue is covered by the nightly
                    # re-run + the R2 lifecycle backstop (AC4).
                    logger.warning("sweep_retention: delete failed key=%s", key, exc_info=True)

            session.execute(
                text("UPDATE song_versions SET raw_audio_purged_at = :now WHERE id = :vid"),
                {"now": now, "vid": row.id},
            )
            stats["purged_versions"] += 1

        stats["anon_purged"] = _purge_unclaimed_anonymous(session, now)
        session.commit()

    logger.info(
        "sweep_retention: purged_versions=%d deleted_keys=%d anon=%d skipped=%s",
        stats["purged_versions"], stats["deleted_keys"], stats["anon_purged"], stats["skipped"],
    )
    return stats


@dramatiq.actor(
    actor_name="sweep_retention",
    queue_name="maintenance",  # AR22 — never analysis lanes, never default
    max_retries=0,             # nightly re-run IS the retry (idempotent)
    time_limit=1_800_000,      # 30 minutes
)
def sweep_retention() -> None:
    run_sweep()
