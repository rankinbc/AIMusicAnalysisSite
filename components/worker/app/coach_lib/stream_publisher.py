"""Redis pub/sub publisher for the coach SSE relay (story 1.6 / Task 3.2).

Channel name: ``coach:{conversation_id}:{message_id}`` (UUIDs stringified,
lowercase, no braces). Wire-format: each PUBLISH carries ONE JSON object
on a single line:

    {"type":"token","text":"..."}
    {"type":"done","evidence":[{"label":"...","path":"..."}, ...]}
    {"type":"refusal","reason":"missing_data","body":"..."}
    {"type":"error","code":"coach_offline","message":"..."}

The BFF subscribes to this channel and relays the JSON to SSE consumers
as the ``data:`` field of the matching ``event:`` frame (see
``components/bff/src/Spectr.Bff/Endpoints/CoachConversationEndpoints.cs``).

The persisted ``coach_messages`` row remains the system of record — the
BFF's idle-fallback branch re-reads the row when pub/sub goes silent
(AR9). Publisher failures here are therefore logged-and-swallowed: a
dead Redis only degrades the streaming UX, never the persisted state.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import uuid
from typing import Any, Mapping, Sequence

import redis

logger = logging.getLogger(__name__)


# ── lazy module-level Redis client ──────────────────────────────────────────

_client_lock = threading.Lock()
_client: redis.Redis | None = None


def _get_client() -> redis.Redis:
    """Return a process-global sync :class:`redis.Redis` client. Lazily
    constructed on first use so unit tests can monkeypatch
    ``redis.Redis.from_url`` BEFORE the publisher touches it.
    """
    global _client
    with _client_lock:
        if _client is None:
            url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
            _client = redis.Redis.from_url(url)
        return _client


def reset_client_cache() -> None:
    """Test helper — drop the cached client so a monkeypatched
    ``redis.Redis.from_url`` rebuild on next publish."""
    global _client
    with _client_lock:
        _client = None


# ── publisher ──────────────────────────────────────────────────────────────

class CoachStreamPublisher:
    """Per-reply publisher to ``coach:{cid}:{mid}``.

    A new instance is constructed per coach reply; PUBLISH calls are
    fire-and-forget (no ACK handling). Errors are logged + swallowed so
    a transient Redis hiccup never raises out of the actor — the
    persisted ``coach_messages`` row is the durable contract; the
    pub/sub stream is the ephemeral UX accelerator.
    """

    def __init__(self, *, conversation_id: uuid.UUID, message_id: uuid.UUID) -> None:
        self.channel = f"coach:{conversation_id}:{message_id}"

    # ── public API ──
    def token(self, text: str) -> None:
        """Publish one prose-delta frame. Empty strings are skipped."""
        if not text:
            return
        self._publish({"type": "token", "text": text})

    def done(self, *, evidence: Sequence[Mapping[str, Any]]) -> None:
        """Publish the terminal answer frame with the resolved evidence
        list. ``evidence`` is the JSON-ready list (each entry has
        ``label`` + ``path`` keys). Accepts any ``Sequence`` so callers
        passing ``list[dict[str, Any]]`` (mypy invariance gotcha) work
        without a cast.
        """
        self._publish({"type": "done", "evidence": list(evidence)})

    def refusal(self, *, reason: str, body: str) -> None:
        """Publish the terminal refusal frame."""
        self._publish({"type": "refusal", "reason": reason, "body": body})

    def error(self, *, code: str, message: str) -> None:
        """Publish a terminal error frame. The BFF maps this to an
        ``event: error`` SSE frame."""
        self._publish({"type": "error", "code": code, "message": message})

    def close(self) -> None:
        """No-op in v1 — the typed terminal frames already signal
        end-of-stream. Reserved for future control-channel cleanup."""

    # ── internal ──
    def _publish(self, payload: Mapping[str, Any]) -> None:
        try:
            client = _get_client()
            client.publish(self.channel, json.dumps(payload, ensure_ascii=False))
        except redis.RedisError:
            logger.warning(
                "coach stream publish failed (channel=%s type=%s); "
                "BFF idle-fallback will recover via the persisted row",
                self.channel, payload.get("type"),
            )
        except Exception:  # noqa: BLE001
            # Defence-in-depth: anything else (e.g. a JSON encoding bug
            # in a future payload field) must NOT escape the actor.
            logger.exception(
                "coach stream publish unexpectedly failed (channel=%s type=%s)",
                self.channel, payload.get("type"),
            )


__all__ = ["CoachStreamPublisher", "reset_client_cache"]
