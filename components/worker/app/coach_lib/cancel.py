"""Cross-process cancel signal for in-flight coach streams (story 1.6 /
Task 3.3).

The BFF's SSE handler watches its consumer's ``HttpContext.RequestAborted``
token. On client disconnect (stop button, tab close, network drop) it
``SET coach:cancel:{message_id} 1 EX 180`` in Redis. The worker actor
polls this key via the closure returned by :func:`cancel_check_for`
between published deltas — the gateway's streaming consumer calls the
closure once per yielded chunk, and on ``True`` flips the
``threading.Event`` that the producer thread reads before its next
``async for`` iteration.

Granularity is per-delta, NOT per-byte. That's intentional — the SDK's
``text_stream`` only yields at delta boundaries, so a finer check would
be wasted work. The Redis EXISTS call is O(1); checking ~100 times per
reply is fine.

Failure mode: a Redis outage causes the closure to return ``False``
(don't cancel). Cancellation is an optimization, not a correctness
guarantee — if pub/sub is down the user's stream is already going to
break via the BFF's idle-fallback (AR9), so the worker continuing to
generate is a non-issue.

The TTL prevents stale cancel keys from poisoning future replies that
happen to reuse a message id (UUIDs collide with vanishing probability
but the EX guard costs nothing).
"""
from __future__ import annotations

import logging
import uuid
from typing import Callable

import redis

# Story 1.6 code review P11: import the MODULE (not the bound symbol) so a
# test fixture that monkeypatches ``stream_publisher._get_client`` reaches
# us too. Binding ``_get_client`` here at import-time would create a
# separate name that the fixture's setattr can't reach, leaving the
# closure's ``True`` branch silently uncovered.
from . import stream_publisher

logger = logging.getLogger(__name__)

CANCEL_KEY_PREFIX = "coach:cancel:"
CANCEL_TTL_S = 180


def cancel_key(message_id: uuid.UUID) -> str:
    """Return the Redis key the BFF SETs and the worker EXISTS-checks."""
    return f"{CANCEL_KEY_PREFIX}{message_id}"


def cancel_check_for(message_id: uuid.UUID) -> Callable[[], bool]:
    """Return a closure that polls ``EXISTS coach:cancel:{message_id}``
    and returns ``True`` iff the BFF has flagged the stream for cancel.

    Failure mode: any :class:`redis.RedisError` (or unexpected exception)
    is logged once and the closure returns ``False`` — see module
    docstring for why "fail open" is the right call here.
    """
    key = cancel_key(message_id)
    logged_error = [False]  # mutable nonlocal for the closure

    def check() -> bool:
        try:
            return bool(stream_publisher._get_client().exists(key))
        except redis.RedisError:
            if not logged_error[0]:
                logger.warning(
                    "coach cancel-check failed for %s — treating as not-cancelled",
                    message_id,
                )
                logged_error[0] = True
            return False
        except Exception:  # noqa: BLE001 — defence in depth
            if not logged_error[0]:
                logger.exception(
                    "coach cancel-check unexpectedly failed for %s", message_id,
                )
                logged_error[0] = True
            return False

    return check


__all__ = ["CANCEL_KEY_PREFIX", "CANCEL_TTL_S", "cancel_check_for", "cancel_key"]
