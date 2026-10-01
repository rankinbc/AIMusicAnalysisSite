"""Env-driven settings for worker run logs. Pure functions — testable without
importing the broker."""
from __future__ import annotations

import os
import re
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path

DEFAULT_RETENTION_DAYS = 14
DEFAULT_CRASH_MAX_ATTEMPTS = 2


def log_dir(local_root: str, environ: Mapping[str, str] | None = None) -> Path:
    """``WORKER_LOG_DIR``, else ``<storage root>/logs/worker`` — the repo's
    gitignored ``data/logs/worker`` in dev, the ``/data`` volume in prod."""
    env = os.environ if environ is None else environ
    explicit = (env.get("WORKER_LOG_DIR") or "").strip()
    return Path(explicit) if explicit else Path(local_root) / "logs" / "worker"


def pool_name(environ: Mapping[str, str] | None = None,
              argv: Sequence[str] | None = None) -> str:
    """Stable name for this worker process: ``WORKER_POOL`` → ``WORKER_QUEUES``
    (prod compose) → the ``--queues`` CLI list → ``all``.

    The boot sweep relies on one process per pool name, which holds because
    every pool runs ``--processes 1``.
    """
    env = os.environ if environ is None else environ
    explicit = (env.get("WORKER_POOL") or "").strip()
    if explicit:
        return _slug(explicit)
    queues = (env.get("WORKER_QUEUES") or "").split()
    if not queues:
        args = list(argv) if argv is not None else []
        if "--queues" in args:
            i = args.index("--queues") + 1
            while i < len(args) and not args[i].startswith("-"):
                queues.append(args[i])
                i += 1
    return _slug("+".join(queues)) if queues else "all"


def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9+._-]", "_", s)[:80] or "all"


def int_env(name: str, default: int, environ: Mapping[str, str] | None = None) -> int:
    env = os.environ if environ is None else environ
    try:
        return int((env.get(name) or "").strip() or default)
    except ValueError:
        return default


def git_sha(environ: Mapping[str, str] | None = None) -> str:
    """Build identity for run headers: ``GIT_SHA`` / ``IMAGE_TAG`` (prod image),
    else ``git rev-parse`` of the checkout (dev), else ``?``."""
    env = os.environ if environ is None else environ
    for key in ("GIT_SHA", "IMAGE_TAG"):
        if (env.get(key) or "").strip():
            return env[key].strip()[:40]
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=Path(__file__).resolve().parent, capture_output=True,
            text=True, timeout=3, check=False,
        )
        return out.stdout.strip() or "?"
    except Exception:  # noqa: BLE001 — a header field must never break boot
        return "?"
