"""On-disk format of per-run log files — pure filesystem code, no dramatiq.

Layout under the worker log dir::

    runs/<YYYY-MM-DD>/<HHMMSS-mmm>_<actor>_<message_id>.log

First line is the header, last ``=== END`` line is the footer. Both are
``key=value`` pairs so workerdash and the poison guard can parse them without
a schema. A run whose file has no footer either is still running or died
without unwinding (native crash, OOM kill, forced stop) — the boot sweep
decides which and writes a ``status=died`` footer for the dead ones.
"""
from __future__ import annotations

import re
import shutil
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

HEADER_PREFIX = "=== RUN "
FOOTER_PREFIX = "=== END "
RUNS_SUBDIR = "runs"

# Footer statuses. `died` is only ever written by the boot sweep.
STATUS_OK = "ok"
STATUS_FAILED = "failed"
STATUS_TIMED_OUT = "timed_out"
STATUS_SKIPPED = "skipped"
STATUS_DIED = "died"
UNFINISHED_STATUSES = (STATUS_DIED,)  # + "no footer at all"

_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_UNSAFE = re.compile(r"[^A-Za-z0-9._:+@/-]")
_TAIL_BYTES = 8192


@dataclass
class RunInfo:
    path: Path
    header: dict[str, str]
    footer: dict[str, str] | None

    @property
    def status(self) -> str:
        """Footer status, or ``running`` when no footer has been written."""
        return (self.footer or {}).get("status", "running")

    @property
    def started(self) -> float:
        try:
            return float(self.header.get("started", "0"))
        except ValueError:
            return 0.0


def _clean(value: object) -> str:
    """Single-token value: no spaces or '=' so the k=v line stays parseable."""
    return _UNSAFE.sub("_", str(value))[:200] or "-"


def format_kv(prefix: str, fields: dict[str, object]) -> str:
    return prefix + " ".join(f"{k}={_clean(v)}" for k, v in fields.items())


def parse_kv(line: str, prefix: str) -> dict[str, str] | None:
    if not line.startswith(prefix):
        return None
    out: dict[str, str] = {}
    for tok in line[len(prefix):].split():
        k, sep, v = tok.partition("=")
        if sep:
            out[k] = v
    return out


def runs_root(log_dir: Path) -> Path:
    return Path(log_dir) / RUNS_SUBDIR


def run_path(log_dir: Path, started: datetime, actor: str, message_id: str) -> Path:
    """A fresh path for this attempt. Retries and redeliveries reuse the
    message id, so the time prefix carries milliseconds and a ``-n`` suffix
    on collision — every attempt gets its own file (the poison guard counts
    them). The message id stays last so ``*_<message_id>.log`` finds them all.
    """
    day = runs_root(log_dir) / started.strftime("%Y-%m-%d")
    stem = started.strftime("%H%M%S-") + f"{started.microsecond // 1000:03d}"
    tail = f"_{_clean(actor)}_{_clean(message_id)}.log"
    path = day / f"{stem}{tail}"
    n = 2
    while path.exists():
        path = day / f"{stem}-{n}{tail}"
        n += 1
    return path


def read_run(path: Path) -> RunInfo:
    """Parse header (first line) + footer (last ``=== END`` line in the tail).

    Only the head line and the last few KB are read — a run log can be large
    and a sweep touches many of them.
    """
    header: dict[str, str] = {}
    footer: dict[str, str] | None = None
    with open(path, "rb") as f:
        first = f.readline().decode("utf-8", "replace").rstrip("\r\n")
        header = parse_kv(first, HEADER_PREFIX) or {}
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - _TAIL_BYTES))
        tail = f.read().decode("utf-8", "replace")
    for line in reversed(tail.splitlines()):
        parsed = parse_kv(line, FOOTER_PREFIX)
        if parsed is not None:
            footer = parsed
            break
    return RunInfo(path=Path(path), header=header, footer=footer)


def append_footer(path: Path, fields: dict[str, object], body: str = "") -> None:
    """Footer is ALWAYS the last line — a traceback goes in ``body`` before it."""
    with open(path, "a", encoding="utf-8") as f:
        if body:
            f.write(body if body.endswith("\n") else body + "\n")
        f.write(format_kv(FOOTER_PREFIX, fields) + "\n")


def day_dirs(log_dir: Path) -> list[Path]:
    root = runs_root(log_dir)
    if not root.is_dir():
        return []
    return sorted(p for p in root.iterdir() if p.is_dir() and _DAY_RE.match(p.name))


def iter_runs(log_dir: Path) -> list[RunInfo]:
    out: list[RunInfo] = []
    for d in day_dirs(log_dir):
        for p in sorted(d.glob("*.log")):
            try:
                out.append(read_run(p))
            except OSError:
                continue
    return out


def runs_for_message(log_dir: Path, message_id: str) -> list[RunInfo]:
    out: list[RunInfo] = []
    for d in day_dirs(log_dir):
        for p in d.glob(f"*_{_clean(message_id)}.log"):
            try:
                out.append(read_run(p))
            except OSError:
                continue
    return out


def count_crashed_attempts(log_dir: Path, message_id: str) -> int:
    """Prior attempts of this message that never unwound (no footer or `died`)."""
    return sum(
        1 for r in runs_for_message(log_dir, message_id)
        if r.footer is None or r.status in UNFINISHED_STATUSES
    )


def sweep_dead_runs(log_dir: Path, pool: str, booted_at: float) -> list[RunInfo]:
    """Footer every unfinished run of ``pool`` that started before this boot.

    A pool is ONE dramatiq process (``--processes 1``), so when a pool's process
    boots, any of its runs still lacking a footer belonged to a previous process
    that is gone. Comparing start time (not pid) is what makes this safe in a
    container, where a restarted process can get the same pid back.
    """
    swept: list[RunInfo] = []
    for run in iter_runs(log_dir):
        if run.footer is not None or run.header.get("pool") != pool:
            continue
        if run.started >= booted_at:
            continue
        append_footer(run.path, {
            "status": STATUS_DIED,
            "detected_at": f"{time.time():.0f}",
            "note": "process_exited_mid_run",
        }, body=(
            "!!! The worker process running this message exited without "
            "unwinding (native crash, out-of-memory kill, or a forced stop). "
            "Any faulthandler stack dump above is the last thing it did."
        ))
        swept.append(read_run(run.path))
    return swept


def prune_old_days(log_dir: Path, retention_days: int, today: date | None = None) -> list[Path]:
    today = today or date.today()
    cutoff = today - timedelta(days=retention_days)
    removed: list[Path] = []
    for d in day_dirs(log_dir):
        try:
            day = datetime.strptime(d.name, "%Y-%m-%d").date()
        except ValueError:
            continue
        if day < cutoff:
            shutil.rmtree(d, ignore_errors=True)
            removed.append(d)
    return removed
