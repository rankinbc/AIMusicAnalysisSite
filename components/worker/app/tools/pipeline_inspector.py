"""Pipeline Inspector CLI.

Trace mode:    python -m app.tools.pipeline_inspector <analysis_id> [--open]
Catalog mode:  python -m app.tools.pipeline_inspector --catalog [--open]
Validate map:  python -m app.tools.pipeline_inspector --validate-map [<analysis_id>|--snapshot FILE]

Catalog + snapshot-validate run with NO database. db_sync is imported lazily,
only when a DB read is actually required.
"""
from __future__ import annotations

import argparse
import json
import sys
import webbrowser
from datetime import datetime
from pathlib import Path

from app.tools.inspector.build import build_catalog_model, build_trace_model
from app.tools.inspector.render import render_html
from app.tools.inspector.stage_map import diff_against_final_json


def _default_out_dir() -> Path:
    date = datetime.now().strftime("%Y-%m-%d")
    # components/worker/app/tools/pipeline_inspector.py → repo output/worker/...
    repo = Path(__file__).resolve().parents[4]
    return repo / "output" / "worker" / f"{date}_pipeline_inspector"


def _write(out_dir: Path, name: str, html_text: str, do_open: bool) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    path.write_text(html_text, encoding="utf-8")
    if do_open:
        webbrowser.open(path.as_uri())
    return path


def _session_factory():
    """Lazy import — only call inside DB-backed branches."""
    from app.db_sync import SessionFactory  # noqa: PLC0415
    return SessionFactory


def _run_validate(args) -> int:
    if args.snapshot:
        try:
            final_json = json.loads(Path(args.snapshot).read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
    else:
        from app.tools.inspector.loader import load_trace, resolve_analysis_id  # noqa: PLC0415
        factory = _session_factory()
        aid = resolve_analysis_id(factory, args.target) if args.target else None
        if aid is None:
            print("--validate-map needs an <analysis_id> or --snapshot FILE", file=sys.stderr)
            return 2
        final_json = load_trace(factory, aid).final_json
    stale_missing, phantom = diff_against_final_json(final_json)
    if not stale_missing and not phantom:
        print("stage map is in sync with the snapshot ✓")
        return 0
    if stale_missing:
        print("STALE/MISSING (pipeline emits, map omits):")
        for p in stale_missing:
            print(f"  + {p}")
    if phantom:
        print("PHANTOM (map declares, snapshot lacks):")
        for p in phantom:
            print(f"  - {p}")
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="pipeline_inspector")
    parser.add_argument("target", nargs="?", help="analysis id (or unique prefix)")
    parser.add_argument("--catalog", action="store_true", help="render catalog only (no DB)")
    parser.add_argument("--validate-map", action="store_true", help="check stage map vs a real final_json")
    parser.add_argument("--snapshot", help="path to a final_json for --validate-map")
    parser.add_argument("--out-dir", help="override output directory")
    parser.add_argument("--open", action="store_true", help="open the result in a browser")
    args = parser.parse_args(argv)

    try:
        if args.validate_map:
            return _run_validate(args)

        out_dir = Path(args.out_dir) if args.out_dir else _default_out_dir()

        if args.catalog:
            html_text = render_html(build_catalog_model())
            path = _write(out_dir, "_catalog.html", html_text, args.open)
            print(f"wrote {path}")
            return 0

        if not args.target:
            parser.error("provide <analysis_id>, --catalog, or --validate-map")

        from app.tools.inspector.loader import load_trace, resolve_analysis_id  # noqa: PLC0415
        factory = _session_factory()
        aid = resolve_analysis_id(factory, args.target)
        raw = load_trace(factory, aid)
        html_text = render_html(build_trace_model(raw))
        path = _write(out_dir, f"{aid[:8]}.html", html_text, args.open)
        print(f"wrote {path}")
        return 0
    except LookupError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
