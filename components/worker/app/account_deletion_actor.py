"""Story 4.6 (FR27) — the async half of account deletion.

The BFF already removed the identity (user row, tokens, audit row) and
enqueued this actor. It deletes the CONTENT subtree + storage objects for
the now-gone user id. Idempotent: re-running against an already-purged id
deletes nothing and succeeds — dramatiq redelivery and manual replays are
safe.

Deliberately RETAINED (decision 3 — pseudonymous financial records, Tax/
NFR23): subscriptions, credit_ledger, usage_events, webhook_events,
llm_calls, audit_log.

Deletion order: storage keys are collected FIRST (rows carry the keys),
then rows delete deepest-first, then objects delete best-effort (an object
delete failure never resurrects rows — the run can be replayed).
"""
from __future__ import annotations

import logging
import uuid as uuid_mod

import dramatiq
from sqlalchemy import text

from . import object_store
from .db_sync import SessionFactory
from .tasks_dramatiq import LOCAL_ROOT

logger = logging.getLogger(__name__)


def _uid_param(s, uid: uuid_mod.UUID):
    """psycopg2 adapts uuid.UUID natively; sqlite (tests) stores the ORM's
    32-hex form and can't bind UUID objects — normalize per dialect."""
    return uid if s.get_bind().dialect.name == "postgresql" else uid.hex


def _collect_storage_keys(s, uid) -> list[str]:
    keys: list[str] = []
    rows = s.execute(text(
        "SELECT v.file_path, v.reference_path, v.als_file_path, v.stem_paths, v.stem_paths_raw "
        "FROM song_versions v JOIN songs sg ON sg.id = v.song_id WHERE sg.user_id = :uid"
    ), {"uid": uid}).all()
    from .retention_actor import _as_json, is_shared_key  # shared helpers

    for r in rows:
        for k in (r.file_path, r.reference_path, r.als_file_path):
            if k:
                keys.append(k)
        stem_paths = _as_json(r.stem_paths) or {}
        if isinstance(stem_paths, dict):
            for entry in stem_paths.values():
                for k in entry if isinstance(entry, list) else [entry]:
                    if k:
                        keys.append(str(k))
        for e in _as_json(r.stem_paths_raw) or []:
            if isinstance(e, dict) and e.get("path"):
                keys.append(str(e["path"]))
            elif isinstance(e, str) and e:
                keys.append(e)

    arows = s.execute(text(
        "SELECT job_id, spectrogram_image_path, waveform_image_path, waveform_peaks_path "
        "FROM analyses WHERE user_id = :uid"
    ), {"uid": uid}).all()
    for r in arows:
        for k in (r.spectrogram_image_path, r.waveform_image_path, r.waveform_peaks_path):
            if k:
                keys.append(k)
        keys.append(f"reports/{r.job_id}.json")  # durable report copy (3.3)

    refs = s.execute(text(
        "SELECT file_path FROM reference_tracks WHERE user_id = :uid AND file_path IS NOT NULL"
    ), {"uid": uid}).all()
    keys.extend(r.file_path for r in refs)

    seen: set[str] = set()
    # Story 12.8 / D2: never collect shared objects (the demo tone, or
    # anything under the audio/demo/ snapshot prefix) — deleting one user
    # (or a guest) must not break every other account's demo playback.
    return [k for k in keys if not is_shared_key(k)
            and not (k in seen or seen.add(k))]


# Deepest-first. Version-scoped FK cascades (song_tags, rack_*) fire from the
# song_versions/songs deletes at the end. Tables absent from this list are
# either FK-cascaded off users (already gone) or retained.
_DELETE_STATEMENTS: tuple[str, ...] = (
    # coach chats
    "DELETE FROM coach_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id = :uid)",
    "DELETE FROM conversations WHERE user_id = :uid",
    # verdict layer (no DB FKs — repo convention)
    "DELETE FROM verdict_user_state WHERE user_id = :uid",
    "DELETE FROM verdicts WHERE analysis_id IN (SELECT id FROM analyses WHERE user_id = :uid)",
    # analyses + jobs
    "DELETE FROM analyses WHERE user_id = :uid",
    "DELETE FROM analysis_jobs WHERE user_id = :uid",
    # per-user annotations
    "DELETE FROM version_user_ratings WHERE user_id = :uid",
    "DELETE FROM version_compare_notes WHERE user_id = :uid",
    "DELETE FROM session_notes WHERE user_id = :uid",
    # reference library
    "DELETE FROM reference_set_members WHERE set_id IN (SELECT id FROM reference_sets WHERE user_id = :uid)",
    "DELETE FROM reference_sets WHERE user_id = :uid",
    "DELETE FROM compare_cache WHERE reference_id IN (SELECT id FROM reference_tracks WHERE user_id = :uid)",
    "DELETE FROM reference_tracks WHERE user_id = :uid",
    # library subtree LAST — fires the version-scoped FK cascades
    "DELETE FROM song_versions WHERE song_id IN (SELECT id FROM songs WHERE user_id = :uid)",
    "DELETE FROM songs WHERE user_id = :uid",
)


def purge_account_data(user_id: str) -> dict:
    """Delete everything content-shaped a user id owned. Returns stats.

    ORDER MATTERS (review-hardened): objects delete BEFORE rows — the rows
    are the only key manifest, so deleting them first would make a failed
    object pass unrecoverable (replay would collect zero keys). With
    objects-first, a crash or storage blip leaves the rows intact; the raise
    below turns dramatiq's max_retries into REAL retries, and replays are
    idempotent (delete_object is missing-ok).
    """
    uid = uuid_mod.UUID(user_id)
    stats = {"rows_deleted": 0, "objects_deleted": 0, "objects_failed": 0}

    with SessionFactory() as s:
        keys = _collect_storage_keys(s, _uid_param(s, uid))

    for key in keys:
        try:
            object_store.delete_object(key, LOCAL_ROOT)
            stats["objects_deleted"] += 1
        except Exception:
            stats["objects_failed"] += 1
            logger.warning("delete_account_data: object delete failed key=%s", key, exc_info=True)
    if stats["objects_failed"]:
        # Rows are still intact — raising makes dramatiq retry the whole run.
        raise RuntimeError(
            f"delete_account_data: {stats['objects_failed']} object delete(s) failed for {user_id} — retrying")

    with SessionFactory.begin() as s:
        p = _uid_param(s, uid)
        for stmt in _DELETE_STATEMENTS:
            result = s.execute(text(stmt), {"uid": p})
            stats["rows_deleted"] += result.rowcount or 0

    logger.info(
        "delete_account_data: user=%s rows=%d objects=%d",
        user_id, stats["rows_deleted"], stats["objects_deleted"],
    )
    return stats


@dramatiq.actor(
    actor_name="delete_account_data",
    queue_name="maintenance",
    max_retries=3,             # object-storage blips retry; row deletes are idempotent
    time_limit=1_800_000,
)
def delete_account_data(user_id: str) -> None:
    purge_account_data(user_id)
