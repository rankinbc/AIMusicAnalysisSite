"""DB-loading entrypoint + CLI for the run-trace harness.

``generate_run_trace(analysis_id)`` loads the persisted analysis + its verdict
rows, hands them to the pure ``build_run_trace`` assembler, and writes the trace
under ``output/worker/<date>_run-traces/``. Best-effort: never raises.

CLI::

    python -m app.trace.generate <analysis_id> [--plain] [--out-dir DIR]
"""
from __future__ import annotations

import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .run_trace import build_run_trace

logger = logging.getLogger(__name__)


def _default_trace_dir() -> Path:
    """``output/worker/<YYYY-MM-DD>_run-traces`` under the repo root (override
    with ``TRACE_DIR``)."""
    override = os.environ.get("TRACE_DIR")
    if override:
        return Path(override)
    # app/trace/generate.py → parents[4] is the repo root.
    repo_root = Path(__file__).resolve().parents[4]
    date = datetime.now().strftime("%Y-%m-%d")
    return repo_root / "output" / "worker" / f"{date}_run-traces"


def _row_to_dict(r: Any) -> dict[str, Any]:
    """Decision-relevant fields of a persisted Verdict ORM row (JSON-safe)."""
    rid = getattr(r, "id", None)
    return {
        "verdict_id": str(rid) if rid is not None else None,
        "problem_id": getattr(r, "problem_id", None),
        "specialist": getattr(r, "specialist", None),
        "severity": getattr(r, "severity", None),
        "category": getattr(r, "category", None),
        "source": getattr(r, "source", None),
        "kind": getattr(r, "kind", None),
        "data_tier": getattr(r, "data_tier", None),
        "fixable": getattr(r, "fixable", None),
        "suspected": getattr(r, "suspected", None),
        "priority_score": getattr(r, "priority_score", None),
        "headline": getattr(r, "headline", None),
        "fix": getattr(r, "fix", None),
    }


def generate_run_trace(
    analysis_id: str | uuid.UUID,
    *,
    analysis_inputs: dict[str, Any] | None = None,
    llm_calls: list[dict[str, Any]] | None = None,
    out_dir: Path | None = None,
    gzip_json: bool = True,
) -> Path | None:
    """Load the analysis (+ persisted verdicts) and write its run trace.
    Best-effort: returns the written path, or ``None`` on any failure."""
    try:
        from sqlalchemy import select  # noqa: PLC0415

        from aimusic_shared.models import Analysis  # noqa: PLC0415
        from aimusic_shared.models import Verdict as VerdictRow  # noqa: PLC0415

        from app.db_sync import SessionFactory  # noqa: PLC0415

        aid = uuid.UUID(str(analysis_id))
        with SessionFactory.begin() as s:
            analysis = s.get(Analysis, aid)
            if analysis is None:
                logger.warning("run trace: analysis %s not found", aid)
                return None
            final_json = analysis.final_json if isinstance(analysis.final_json, dict) else {}
            rows = s.execute(
                select(VerdictRow).where(VerdictRow.analysis_id == aid)
            ).scalars().all()
            persisted = [_row_to_dict(r) for r in rows]

        trace = build_run_trace(
            run_id=str(aid),
            analysis_id=str(aid),
            created_at=datetime.now(timezone.utc).isoformat(),
            final_json=final_json,
            analysis_inputs=analysis_inputs,
            persisted_verdicts=persisted,
            llm_calls=llm_calls,
        )
        path = trace.write(out_dir or _default_trace_dir(), gzip_json=gzip_json)
        logger.info("run trace: wrote %s", path)
        return path
    except Exception:
        logger.exception("run trace: generation failed for analysis=%s", analysis_id)
        return None


def main(argv: list[str] | None = None) -> int:
    import argparse

    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser(description="Generate a run-trace JSON for an analysis.")
    ap.add_argument("analysis_id", help="Analysis UUID to trace")
    ap.add_argument("--plain", action="store_true",
                    help="write uncompressed .json (default: .json.gz)")
    ap.add_argument("--out-dir", default=None,
                    help="output dir (default: output/worker/<date>_run-traces)")
    args = ap.parse_args(argv)

    path = generate_run_trace(
        args.analysis_id,
        out_dir=Path(args.out_dir) if args.out_dir else None,
        gzip_json=not args.plain,
    )
    if path is None:
        print("trace generation failed (see logs)", file=sys.stderr)
        return 1
    print(str(path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
