"""Dramatiq actor: synthesize a Room session recap (Listen V3 / PRP-4).

    synthesize_recap(session_id: str)

The SOLE FINALIZE PATH for a live Room (G1). It is idempotent and the only
flusher of the Redis write-ahead log to Postgres — the BFF never flushes inline
(no DEL-before-actor-reads race). Three triggers all just ENQUEUE this actor:
clean ``/end`` (immediate), the last-leaver delayed finalize (~3min, re-checks
presence), and the lazy-on-read backstop (``GET /sessions/{id}`` on a
presence-empty live session).

Lifecycle:
  1. Re-check presence (delayed-trigger guard): if anyone is still present, the
     session isn't really over — no-op, let a later trigger finalize.
  2. LRANGE ``room:{id}:log`` → the durable event archive.
  3. CAS flush (the idempotency gate): ``UPDATE listening_sessions SET
     status='ended', events_json=…, ended_at=now() WHERE id=… AND status='live'``.
     Only the winner (rowcount=1) proceeds; losers (already ended) no-op.
  4. The winner: DEL the Redis keys, compute ``recap_json`` (hottest moments =
     reaction-density peaks, histogram, peak concurrency, attendance), persist it.

``room:{id}`` keys use the C# Guid "N" format (32 lowercase hex, no hyphens) ==
Python ``uuid.UUID.hex``.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from collections import Counter
from typing import Any

import dramatiq

logger = logging.getLogger(__name__)

# Reaction-density bucket width, in playhead seconds.
_BUCKET_SECONDS = 5
_MAX_HOTTEST = 5


def _redis_client():
    """Process-global sync redis client (lazy — mirrors stream_publisher so unit
    tests can monkeypatch ``redis.Redis.from_url`` before the actor touches it)."""
    import redis  # noqa: PLC0415

    url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    return redis.Redis.from_url(url)


def _room_keys(session_hex: str) -> list[str]:
    base = f"room:{session_hex}"
    return [f"{base}:log", f"{base}:seq", f"{base}:chain",
            f"{base}:transport", f"{base}:visuals", f"{base}:present"]


def compute_recap(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Derive the recap projection from the flushed event log. Pure (no I/O) so
    it is unit-testable in isolation. Shape (seams §3):
        { hottestMoments: {t, reactionCount, topEmoji}[], reactionHistogram,
          peakConcurrency, attendance: ActorRef[] }
    """
    reactions = [e for e in events if e.get("type") == "reaction"]

    histogram: Counter[str] = Counter()
    buckets: dict[int, Counter[str]] = {}
    for r in reactions:
        emoji = r.get("emoji")
        if not isinstance(emoji, str):
            continue
        histogram[emoji] += 1
        t = r.get("t") or 0
        bucket = int(t // _BUCKET_SECONDS) * _BUCKET_SECONDS
        buckets.setdefault(bucket, Counter())[emoji] += 1

    moments: list[tuple[int, int, str]] = []
    for bucket, emojis in buckets.items():
        count = sum(emojis.values())
        top_emoji, _ = emojis.most_common(1)[0]
        moments.append((bucket, count, top_emoji))
    # Densest first; stable tie-break by playhead so ties are deterministic.
    moments.sort(key=lambda m: (-m[1], m[0]))
    hottest = [
        {"t": b, "reactionCount": c, "topEmoji": e}
        for b, c, e in moments[:_MAX_HOTTEST]
    ]

    # Peak concurrency + attendance from presence join/leave (seq-ordered).
    running = 0
    peak = 0
    attendance: dict[str, dict[str, Any]] = {}
    for e in sorted(events, key=lambda x: x.get("seq", 0)):
        if e.get("type") != "presence":
            continue
        actor = e.get("actor") or {}
        if e.get("state") == "join":
            running += 1
            peak = max(peak, running)
            key = _actor_key(actor)
            attendance.setdefault(key, actor)
        elif e.get("state") == "leave":
            running = max(0, running - 1)

    return {
        "hottestMoments": hottest,
        "reactionHistogram": dict(histogram),
        "peakConcurrency": peak,
        "attendance": list(attendance.values()),
    }


def _actor_key(actor: dict[str, Any]) -> str:
    """Stable dedup key for an ActorRef dict (user id, else anon display name)."""
    if actor.get("userId"):
        return f"user:{actor['userId']}"
    return f"anon:{actor.get('displayName') or actor.get('hue')}"


@dramatiq.actor(
    actor_name="synthesize_recap",
    queue_name="analysis-paid",
    max_retries=1,
    time_limit=120_000,  # 2 minutes
)
def synthesize_recap(session_id: str) -> None:
    """See module docstring. Sole flusher; idempotent via the status CAS."""
    sid = uuid.UUID(session_id)
    logger.info("synthesize_recap start session=%s", session_id)

    client = _redis_client()
    keys = _room_keys(sid.hex)
    log_key = keys[0]

    # 1. Delayed-trigger presence guard: anyone still here → not over yet.
    try:
        if client.hlen(f"room:{sid.hex}:present") > 0:
            logger.info("synthesize_recap: session %s still has presence — skipping", session_id)
            return
    except Exception:
        logger.exception("synthesize_recap: presence check failed for %s", session_id)
        # Fall through — better to finalize than strand the session.

    # 2. Read the durable WAL.
    try:
        raw_entries = client.lrange(log_key, 0, -1)
    except Exception:
        logger.exception("synthesize_recap: LRANGE failed for %s", session_id)
        return
    events: list[dict[str, Any]] = []
    for raw in raw_entries:
        try:
            events.append(json.loads(raw))
        except (ValueError, TypeError):
            continue  # skip a corrupt entry; never sink the whole recap

    # 3. CAS flush — the idempotency gate. Only the winner proceeds.
    from sqlalchemy import text  # noqa: PLC0415

    from .db_sync import SessionFactory  # noqa: PLC0415 — lazy DB import

    try:
        with SessionFactory.begin() as s:
            result = s.execute(
                text(
                    "UPDATE listening_sessions "
                    "SET status='ended', events_json=CAST(:log AS jsonb), ended_at=now() "
                    "WHERE id=:id AND status='live'"
                ),
                {"log": json.dumps(events), "id": str(sid)},
            )
            # rowcount lives on CursorResult; getattr keeps mypy happy on the base type.
            won = getattr(result, "rowcount", 0) == 1
    except Exception:
        logger.exception("synthesize_recap: CAS flush failed for %s", session_id)
        return

    if not won:
        logger.info("synthesize_recap: session %s already finalized — no-op", session_id)
        return

    # 4. Winner only: drop the Redis keys + compute and persist the recap.
    try:
        client.delete(*keys)
    except Exception:
        logger.exception("synthesize_recap: key cleanup failed for %s (non-fatal)", session_id)

    recap = compute_recap(events)
    try:
        with SessionFactory.begin() as s:
            s.execute(
                text("UPDATE listening_sessions SET recap_json=CAST(:recap AS jsonb) WHERE id=:id"),
                {"recap": json.dumps(recap), "id": str(sid)},
            )
    except Exception:
        logger.exception("synthesize_recap: recap persist failed for %s", session_id)
        return

    logger.info(
        "synthesize_recap done session=%s events=%d hottest=%d peak=%d",
        session_id, len(events), len(recap["hottestMoments"]), recap["peakConcurrency"],
    )
