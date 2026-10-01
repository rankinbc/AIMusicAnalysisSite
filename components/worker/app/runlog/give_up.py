"""Give-up hooks: one place that writes an actor's terminal state when its
message is finished FOR GOOD.

Why this exists: each actor writes its failure state inside an
``except Exception`` arm, which misses two real ways a message dies:

* dramatiq's ``TimeLimitExceeded`` derives from ``BaseException``, so a
  time-limit kill skips every ``except Exception`` arm — the job row stays
  ``processing``, the coach bubble stays ``pending``, the tile never fails.
* a native crash (segfault, OpenMP abort, OOM kill) runs no Python at all, and
  the poison guard later skips the redelivered message.

The run-log middleware calls ``run_hook`` in both cases. Hooks MUST be
idempotent and must only move non-terminal rows — the actor's own failure arm
may already have written a better message.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)

# Reasons passed to hooks; also used as the job row's error_code.
REASON_TIMED_OUT = "timed_out"
REASON_RETRIES_EXHAUSTED = "retries_exhausted"
REASON_WORKER_CRASHED = "worker_crashed"

Hook = Callable[[tuple, dict, str, "BaseException | None"], None]
_HOOKS: dict[str, Hook] = {}


def on_give_up(actor_name: str) -> Callable[[Hook], Hook]:
    def register(fn: Hook) -> Hook:
        _HOOKS[actor_name] = fn
        return fn
    return register


def has_hook(actor_name: str) -> bool:
    return actor_name in _HOOKS


def run_hook(actor_name: str, args: Any, kwargs: Any, reason: str,
             exc: BaseException | None) -> bool:
    """Run the actor's hook. Never raises; returns True when a hook ran OK."""
    hook = _HOOKS.get(actor_name)
    if hook is None:
        return False
    try:
        hook(tuple(args or ()), dict(kwargs or {}), reason, exc)
        logger.warning("give-up: %s terminal state written (reason=%s)", actor_name, reason)
        return True
    except Exception:
        logger.exception("give-up hook failed for %s (reason=%s)", actor_name, reason)
        return False


def arg(args: tuple, kwargs: dict, index: int, name: str) -> Any:
    """Fetch an actor argument whether it was sent positionally or by keyword."""
    if name in kwargs:
        return kwargs[name]
    return args[index] if len(args) > index else None
