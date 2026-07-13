"""Story 3.4 (AR22/NFR20/NFR26) — the authoritative nightly retention sweep.

``sweep_retention`` purges RAW AUDIO objects (mix / stems / .als / reference)
for versions past their retention window and stamps
``song_versions.raw_audio_purged_at`` — the idempotency key. Reports
(``analyses.final_json`` + rendered images + ``reports/{jobId}.json``),
verdicts, and coach chats are NEVER touched: results live forever (AR15).

Tier rules (decided per USER, from the BFF-owned billing tables read via
SQLAlchemy Core ``text()`` — the feature_flags.py precedent):

    PROTECTED  any subscription row whose status is NOT a lapsed status
               (covers active/trialing/past_due AND unknown/new Stripe
               statuses — unknown fails SAFE), OR credit balance > 0, OR a
               lapsed row still inside the grace window, OR the mirror's
               far-future sentinel period_end, OR a lapse we cannot anchor.
    LAPSED     newest lapse anchored at current_period_end and
               now > period_end + lapsed_days  -> purge ALL raw audio
    FREE       no subscription rows at all      -> purge per-version once
               version.created_at < now - RETENTION_FREE_DAYS

FAIL-CLOSED: if the billing queries error, the sweep purges NOTHING that run.

Review-hardened mechanics:
  * per-version short transactions — deletes (network I/O) never hold a DB
    tx, and a crash/time-limit mid-run keeps every already-stamped marker;
  * a version whose deletes ALL failed is NOT marked — it retries nightly;
  * candidates are bounded in SQL (free window OR lapsed users), not a full
    unpurged-table scan;
  * a paid signal is re-checked per user at purge time — someone who pays
    mid-sweep (perhaps prompted by the warning email) is spared;
  * ``lapsed_days`` can be passed by the BFF scheduler so the warning emails
    and the purge share ONE policy value (env is the fallback).

Env (AR40): RETENTION_FREE_DAYS=30, RETENTION_LAPSED_DAYS=90,
RETENTION_ANON_HOURS=72 (anon guard no-ops until Epic 4 adds devices).
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone

import dramatiq
from sqlalchemy import bindparam, text

from . import object_store
from .db_sync import SessionFactory
from .tasks_dramatiq import LOCAL_ROOT

logger = logging.getLogger(__name__)

_LAPSED_STATUSES = ("canceled", "unpaid", "incomplete_expired")


def _free_days() -> int:
    return int(os.environ.get("RETENTION_FREE_DAYS", "30"))


def _env_lapsed_days() -> int:
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


# Story 12.8: the first-run demo audio is ONE shared object referenced by a
# per-user demo SongVersion in EVERY account. Purging it via any single user's
# retention/deletion pass would break demo playback fleet-wide.
SHARED_STORAGE_KEYS = frozenset({"audio/demo/source.wav"})


def _version_keys(row) -> list[str]:
    """Every raw-audio storage key a version row references (exact keys only).
    Shared objects (the 12.8 demo tone) are never returned — they are not any
    one user's data."""
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
        elif isinstance(e, str) and e:  # legacy shape: plain string list
            keys.append(e)
    # De-dup while preserving order (grouped stem_paths repeat raw keys).
    seen: set[str] = set()
    return [k for k in keys if k not in SHARED_STORAGE_KEYS
            and not (k in seen or seen.add(k))]


def _classify_users(session, now: datetime, lapsed_days: int) -> tuple[set, set]:
    """Return (protected_user_ids, lapsed_purgeable_user_ids). Raises on
    failure (the caller fails CLOSED)."""
    sentinel_cutoff = now + timedelta(days=365 * 5)
    lapse_cutoff = now - timedelta(days=lapsed_days)

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
        if status not in _LAPSED_STATUSES:
            # active/trialing/past_due AND any unknown/new Stripe status —
            # unknown must fail SAFE, never fall to the shorter free rule.
            protected.add(r.user_id)
            continue
        period_end = _as_dt(r.current_period_end)
        if period_end is None:
            protected.add(r.user_id)  # cannot anchor the lapse — fail safe
        elif period_end > sentinel_cutoff:
            protected.add(r.user_id)  # mirror-sentinel row — treat as paid
        elif period_end < lapse_cutoff:
            lapsed_purgeable.add(r.user_id)
        else:
            protected.add(r.user_id)  # lapsed but inside the grace window
    return protected, lapsed_purgeable - protected


def _is_paid_now(session, user_id) -> bool:
    """Purge-time re-check: a paid signal acquired AFTER classification (the
    warning email often triggers exactly that) spares the user this run."""
    sub = session.execute(
        text("SELECT 1 FROM subscriptions WHERE user_id = :u AND lower(status) NOT IN ('canceled','unpaid','incomplete_expired') LIMIT 1"),
        {"u": user_id},
    ).first()
    if sub is not None:
        return True
    balance = session.execute(
        text("SELECT COALESCE(SUM(amount), 0) FROM credit_ledger WHERE user_id = :u"),
        {"u": user_id},
    ).scalar()
    return (balance or 0) > 0


def _anon_hours() -> int:
    return int(os.environ.get("RETENTION_ANON_HOURS", "72"))


def _purge_unclaimed_anonymous(now: datetime) -> int:
    """Story 4.5 (AR26) — devices unclaimed for > RETENTION_ANON_HOURS purge
    WITH their owned rows (jobs, reports, conversations + coach messages).
    NFR20's reports-live-forever guarantee does NOT apply here: unclaimed
    means there is no owner to keep a report for — that IS the 72 h deal the
    anonymous funnel offers. Claimed devices' rows were already re-parented
    to a user (device_id NULL) so they can never match. Runs in its OWN
    session; any failure is logged and never poisons the sweep. Storage
    objects for anon jobs are deleted when 6.3 fixes the anon key
    convention — today anon rows have no uploaded keys to chase (row purge
    is the complete story until then).

    Returns the number of devices purged. Tolerates the table being absent
    (pre-4.5 databases, partial sqlite test mirrors).
    """
    cutoff = now - timedelta(hours=_anon_hours())
    total = 0
    try:
        while True:  # batches of 500 — expanding IN must never blow the param limit
            with SessionFactory.begin() as s:
                is_pg = s.get_bind().dialect.name == "postgresql"
                # Device rows locked FIRST (same first-lock as the claim tx —
                # no lock-order inversion) and SKIP LOCKED: a device mid-claim
                # is simply not this sweep's business. Active jobs exclude the
                # device — a 72h-old device mid-analysis keeps its work.
                select_sql = (
                    "SELECT id FROM devices d "
                    "WHERE claimed_at IS NULL AND created_at < :cutoff "
                    "AND NOT EXISTS (SELECT 1 FROM analysis_jobs j "
                    "  WHERE j.device_id = d.id AND j.status IN "
                    "  ('pending','processing','awaiting_stem_mapping')) "
                    "LIMIT 500"
                )
                if is_pg:
                    select_sql += " FOR UPDATE SKIP LOCKED"
                stale = [r.id for r in s.execute(text(select_sql), {"cutoff": cutoff}).all()]
                if not stale:
                    break

                s.execute(
                    text(
                        "DELETE FROM coach_messages WHERE conversation_id IN "
                        "(SELECT id FROM conversations WHERE device_id IN :dids)"
                    ).bindparams(bindparam("dids", expanding=True)),
                    {"dids": stale},
                )
                # Verdicts hang off analyses with no DB-level FK (repo
                # convention) — delete them explicitly or they orphan.
                s.execute(
                    text(
                        "DELETE FROM verdicts WHERE analysis_id IN "
                        "(SELECT id FROM analyses WHERE device_id IN :dids)"
                    ).bindparams(bindparam("dids", expanding=True)),
                    {"dids": stale},
                )
                # Child order matches the claim tx (jobs → analyses →
                # conversations) so concurrent claim/purge can't deadlock.
                for table in ("analysis_jobs", "analyses", "conversations"):
                    stmt = text(
                        f"DELETE FROM {table} WHERE device_id IN :dids"  # noqa: S608 — fixed table list
                    ).bindparams(bindparam("dids", expanding=True))
                    s.execute(stmt, {"dids": stale})
                # Belt on top of the row lock: never delete a device that got
                # claimed since the SELECT (non-PG test dialects have no lock).
                s.execute(
                    text("DELETE FROM devices WHERE id IN :dids AND claimed_at IS NULL")
                    .bindparams(bindparam("dids", expanding=True)),
                    {"dids": stale},
                )
                total += len(stale)
            if len(stale) < 500:
                break
        if total:
            logger.info("sweep_retention: purged %d unclaimed anon device(s)", total)
        return total
    except Exception:
        # WARNING, not info: a recurring failure here silently breaks the
        # 72 h retention promise. (Absent table — pre-4.5 DBs, partial sqlite
        # mirrors — also lands here; acceptable noise in those environments.)
        logger.warning("sweep_retention: anon purge failed", exc_info=True)
        return total


def _load_candidates(session, free_cutoff: datetime, lapsed_purgeable: set):
    """Bounded candidate load: free-window versions OR lapsed users' versions.
    Never a full unpurged-table scan."""
    base = (
        "SELECT v.id, v.created_at, s.user_id, "
        "v.file_path, v.reference_path, v.als_file_path, "
        "v.stem_paths, v.stem_paths_raw "
        "FROM song_versions v JOIN songs s ON s.id = v.song_id "
        "WHERE v.raw_audio_purged_at IS NULL "
    )
    rows = list(session.execute(
        text(base + "AND v.created_at < :cutoff"), {"cutoff": free_cutoff}
    ).all())
    if lapsed_purgeable:
        stmt = text(base + "AND s.user_id IN :uids").bindparams(
            bindparam("uids", expanding=True))
        rows += session.execute(stmt, {"uids": list(lapsed_purgeable)}).all()
    seen: set = set()
    return [r for r in rows if not (r.id in seen or seen.add(r.id))]


def _purge_stale_auth_tokens(now: datetime) -> int:
    """Story 4.3 review — auth_tokens (verify/reset) grows unbounded without
    this: delete consumed rows and rows expired > 7 days (the trailing window
    keeps very-recent history for support diagnosis). Own session; tolerant of
    the table being absent (sqlite test DBs mirror only worker-read tables)."""
    try:
        with SessionFactory.begin() as s:
            result = s.execute(text(
                "DELETE FROM auth_tokens "
                "WHERE consumed_at IS NOT NULL OR expires_at < :cutoff"
            ), {"cutoff": now - timedelta(days=7)})
            return result.rowcount or 0
    except Exception:
        logger.info("sweep_retention: auth_tokens purge skipped", exc_info=True)
        return 0


def _requeue_orphaned_account_purges() -> int:
    """Story 4.6 review self-heal: if the BFF's purge enqueue failed (Redis
    blip after the user row was already deleted), content rows sit orphaned
    with no retry handle — the user can't even log in to retry. Detect
    user_ids that own songs/analyses but have no users row and re-enqueue
    delete_account_data. Idempotent (the actor tolerates replays)."""
    try:
        with SessionFactory() as s:
            orphans = [str(r.user_id) for r in s.execute(text(
                "SELECT DISTINCT user_id FROM songs sg "
                "WHERE user_id IS NOT NULL "
                "AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = sg.user_id) "
                "LIMIT 20"
            )).all()]
        if not orphans:
            return 0
        from .account_deletion_actor import delete_account_data

        for uid in orphans:
            delete_account_data.send(uid)
        logger.warning(
            "sweep_retention: re-enqueued account purge for %d orphaned user id(s)", len(orphans))
        return len(orphans)
    except Exception:
        logger.warning("sweep_retention: orphaned-account check failed", exc_info=True)
        return 0


def run_sweep(now: datetime | None = None, lapsed_days: int | None = None) -> dict:
    """One idempotent sweep pass. Returns stats for logging/tests."""
    now = now or datetime.now(timezone.utc)
    lapsed_days = lapsed_days or _env_lapsed_days()
    stats = {
        "purged_versions": 0, "deleted_objects": 0, "missing_objects": 0,
        "failed_versions": 0, "anon_purged": 0, "skipped": False,
    }

    # ── Phase 1: classification (own session) — FAIL-CLOSED on error ────────
    try:
        with SessionFactory() as session:
            protected, lapsed_purgeable = _classify_users(session, now, lapsed_days)
    except Exception:
        logger.exception("sweep_retention: billing classification failed — purging NOTHING")
        stats["skipped"] = True
        return stats

    # ── Phase 2: bounded candidate load (own session, read-only) ────────────
    free_cutoff = now - timedelta(days=_free_days())
    with SessionFactory() as session:
        candidates = _load_candidates(session, free_cutoff, lapsed_purgeable)

    # ── Phase 3: per-version purge — deletes OUTSIDE any tx, marker in a
    # short tx per version (crash/time-limit keeps completed markers) ───────
    paid_recheck: dict = {}
    for row in candidates:
        if row.user_id in protected:
            continue
        created = _as_dt(row.created_at)
        if row.user_id not in lapsed_purgeable and (created is None or created >= free_cutoff):
            continue

        if row.user_id not in paid_recheck:
            try:
                with SessionFactory() as session:
                    paid_recheck[row.user_id] = _is_paid_now(session, row.user_id)
            except Exception:
                paid_recheck[row.user_id] = True  # unknown → fail safe
        if paid_recheck[row.user_id]:
            continue

        keys = _version_keys(row)
        removed = missing = failed = 0
        for key in keys:
            try:
                if object_store.delete_object(key, LOCAL_ROOT):
                    removed += 1
                else:
                    missing += 1
            except Exception:
                failed += 1
                logger.warning("sweep_retention: delete failed key=%s", key, exc_info=True)

        if keys and failed == len(keys):
            # NOTHING was deleted — do NOT mark; retry next night instead of
            # permanently orphaning the objects behind the idempotency filter.
            stats["failed_versions"] += 1
            continue

        with SessionFactory.begin() as session:
            session.execute(
                text("UPDATE song_versions SET raw_audio_purged_at = :now WHERE id = :vid"),
                {"now": now, "vid": row.id},
            )
        stats["purged_versions"] += 1
        stats["deleted_objects"] += removed
        stats["missing_objects"] += missing

    if stats["purged_versions"] > 0 and stats["deleted_objects"] == 0:
        # Every "purge" hit only-missing objects — likely a LOCAL_ROOT/bucket
        # misconfiguration silently no-opping retention. Loud signal, no throw.
        logger.warning(
            "sweep_retention: %d versions marked purged but ZERO objects were "
            "actually deleted — check LOCAL_ROOT / S3 configuration",
            stats["purged_versions"],
        )

    stats["anon_purged"] = _purge_unclaimed_anonymous(now)
    stats["auth_tokens_purged"] = _purge_stale_auth_tokens(now)
    stats["orphaned_accounts_requeued"] = _requeue_orphaned_account_purges()

    logger.info(
        "sweep_retention: purged=%d deleted=%d missing=%d failed=%d anon=%d skipped=%s",
        stats["purged_versions"], stats["deleted_objects"], stats["missing_objects"],
        stats["failed_versions"], stats["anon_purged"], stats["skipped"],
    )
    return stats


@dramatiq.actor(
    actor_name="sweep_retention",
    queue_name="maintenance",  # AR22 — never analysis lanes, never default
    max_retries=0,             # nightly re-run IS the retry (idempotent)
    time_limit=1_800_000,      # 30 minutes
)
def sweep_retention(lapsed_days: int | None = None) -> None:
    # lapsed_days is passed by the BFF scheduler so warnings and purge share
    # one policy value; None falls back to RETENTION_LAPSED_DAYS.
    run_sweep(lapsed_days=lapsed_days)
