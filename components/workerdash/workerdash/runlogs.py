"""Worker per-run log files (written by the worker's RunLogMiddleware).

workerdash must not import the worker package, so the tiny header/footer
format is parsed here standalone. Format (see
components/worker/app/runlog/runfiles.py):

    <log_dir>/runs/<YYYY-MM-DD>/<HHMMSS-mmm>_<actor>_<message_id>.log
    first line  "=== RUN k=v k=v ..."     (actor, message_id, pool, started, ...)
    then        "arg[0]: '...'"           (actor args, truncated)
    last footer "=== END status=... ..."  (absent = still running / died unswept)
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from flask import jsonify, request, send_file

from . import files as files_mod

HEADER = "=== RUN "
FOOTER = "=== END "
_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_NAME_RE = re.compile(r"^[A-Za-z0-9._:+@-]+\.log$")
_HEAD_BYTES = 4096
_TAIL_BYTES = 8192
# A run with no footer is either running now or died and its pool hasn't
# rebooted to sweep it yet — the dashboard can't tell which, so it says so.
NO_FOOTER = "running_or_died"


def log_dir() -> Path:
    """Same rule as the worker: WORKER_LOG_DIR, else <storage root>/logs/worker."""
    explicit = (os.environ.get("WORKER_LOG_DIR") or "").strip()
    return Path(explicit) if explicit else Path(files_mod.local_root()) / "logs" / "worker"


def _kv(line: str, prefix: str) -> dict:
    if not line.startswith(prefix):
        return {}
    out = {}
    for tok in line[len(prefix):].split():
        k, sep, v = tok.partition("=")
        if sep:
            out[k] = v
    return out


def parse(path: Path) -> dict:
    with open(path, "rb") as f:
        head = f.read(_HEAD_BYTES).decode("utf-8", "replace")
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - _TAIL_BYTES))
        tail = f.read().decode("utf-8", "replace")
    lines = head.splitlines()
    header = _kv(lines[0], HEADER) if lines else {}
    footer = {}
    for line in reversed(tail.splitlines()):
        footer = _kv(line, FOOTER)
        if footer:
            break
    args = [ln for ln in lines[1:20] if ln.startswith(("arg[", "kwarg[", "args:"))]
    return {
        "day": path.parent.name,
        "name": path.name,
        "actor": header.get("actor"),
        "message_id": header.get("message_id"),
        "pool": header.get("pool"),
        "retries": header.get("retries"),
        "prior_crashes": header.get("prior_crashes"),
        "started": header.get("started"),
        "status": footer.get("status", NO_FOOTER),
        "duration_s": footer.get("duration_s"),
        "exc": footer.get("exc"),
        "retry": footer.get("retry"),
        "reason": footer.get("reason"),
        "args": args,
        "size": size,
    }


def list_runs(root: Path, *, status: str | None = None, actor: str | None = None,
              search: str | None = None, days: int = 3, limit: int = 200) -> list[dict]:
    """Newest first. ``search`` matches the header + args (job / analysis /
    conversation ids are actor args), so the Operations drill-down can find a
    job's runs by its id."""
    runs_root = Path(root) / "runs"
    if not runs_root.is_dir():
        return []
    day_dirs = sorted((d for d in runs_root.iterdir()
                       if d.is_dir() and _DAY_RE.match(d.name)), reverse=True)[:max(1, days)]
    out: list[dict] = []
    for d in day_dirs:
        for p in sorted(d.glob("*.log"), reverse=True):
            try:
                row = parse(p)
            except OSError:
                continue
            if status and row["status"] != status:
                continue
            if actor and row["actor"] != actor:
                continue
            if search and search not in p.name and not any(search in a for a in row["args"]):
                continue
            out.append(row)
            if len(out) >= limit:
                return out
    return out


def resolve(root: Path, day: str, name: str) -> Path | None:
    """Path-traversal-safe lookup of one run file."""
    if not _DAY_RE.match(day) or not _NAME_RE.match(name):
        return None
    p = Path(root) / "runs" / day / name
    return p if p.is_file() else None


def register(app, root_fn=log_dir) -> None:  # noqa: ANN001
    @app.get("/api/runlogs")
    def runlogs_list():
        a = request.args
        try:
            rows = list_runs(
                root_fn(), status=a.get("status") or None, actor=a.get("actor") or None,
                search=(a.get("search") or "").strip() or None,
                days=int(a.get("days", 3)), limit=int(a.get("limit", 200)))
            return jsonify({"ok": True, "dir": str(root_fn()), "rows": rows})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e), "rows": []})

    @app.get("/api/runlogs/<day>/<name>")
    def runlogs_file(day, name):
        p = resolve(root_fn(), day, name)
        if p is None:
            return jsonify({"ok": False, "error": "not found"}), 404
        return send_file(p, mimetype="text/plain; charset=utf-8")
