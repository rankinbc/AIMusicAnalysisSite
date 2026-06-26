"""CLI: measure a reference-track corpus and propose genre-profiles.json updates.

    python -m app.tools.genre_corpus <reference_dir> [--profiles PATH]
                                     [--out report.json] [--write] [--min-tracks N]

``<reference_dir>/<genre>/*.{wav,flac,mp3,aiff,m4a,ogg}`` - each subfolder name maps
to a profile key via ``genre_config.resolve_genre`` (so ``trance/`` -> ``modern_trance``).
Dry-run by default (prints/writes a report + proposed changes); ``--write`` patches
genre-profiles.json after backing it up to ``genre-profiles.json.bak``.
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from .measure import measure_track
from .propose import propose_updates
from .stats import aggregate

logger = logging.getLogger("genre_corpus")

_AUDIO_EXT = {".wav", ".flac", ".mp3", ".aiff", ".aif", ".m4a", ".ogg"}


def _gather(ref_dir: Path, resolve) -> dict[str, list[Path]]:
    """Map each genre subfolder → its audio files, keyed by resolved profile name."""
    by_genre: dict[str, list[Path]] = {}
    for sub in sorted(p for p in ref_dir.iterdir() if p.is_dir()):
        key = resolve(sub.name)
        tracks = [f for f in sorted(sub.rglob("*")) if f.suffix.lower() in _AUDIO_EXT]
        if tracks:
            by_genre.setdefault(key, []).extend(tracks)
    return by_genre


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(prog="genre_corpus", description=__doc__)
    ap.add_argument("reference_dir", help="dir of <genre>/<track> reference files")
    ap.add_argument("--profiles", default=None,
                    help="genre-profiles.json path (default: the worker config copy)")
    ap.add_argument("--out", default=None, help="write the JSON report here (default: stdout)")
    ap.add_argument("--write", action="store_true",
                    help="apply the proposal to genre-profiles.json (backs up to .bak)")
    ap.add_argument("--min-tracks", type=int, default=8,
                    help="warn when a genre has fewer than N measured tracks")
    args = ap.parse_args(argv)

    from app.verdict_lib import genre_config  # noqa: PLC0415 — resolve_genre + config path
    profiles_path = Path(args.profiles) if args.profiles else (genre_config._DIR / "genre-profiles.json")
    current = json.loads(profiles_path.read_text(encoding="utf-8"))

    ref = Path(args.reference_dir)
    if not ref.is_dir():
        print(f"reference dir not found: {ref}", file=sys.stderr)
        return 1
    by_genre = _gather(ref, genre_config.resolve_genre)
    if not by_genre:
        print(f"no genre subfolders with audio under {ref}", file=sys.stderr)
        return 1

    agg_by_genre = {}
    for genre, tracks in by_genre.items():
        rows = []
        for track in tracks:
            try:
                rows.append(measure_track(track))
                logger.info("measured [%s] %s", genre, track.name)
            except Exception as exc:  # noqa: BLE001 — one bad file shouldn't sink the run
                logger.warning("skip %s: %s", track.name, exc)
        if 0 < len(rows) < args.min_tracks:
            logger.warning("genre %s: only %d tracks (< %d) - low-n, treat as provisional",
                           genre, len(rows), args.min_tracks)
        if rows:
            agg_by_genre[genre] = aggregate(rows)

    if not agg_by_genre:
        print("no tracks measured successfully", file=sys.stderr)
        return 1

    result = propose_updates(agg_by_genre, current)
    report = {
        "track_counts": {g: len(t) for g, t in by_genre.items()},
        "changes": result["changes"],
        "report": result["report"],
    }
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2), encoding="utf-8")
        logger.info("wrote report -> %s", args.out)
    else:
        print(json.dumps(report, indent=2))

    if args.write:
        bak = profiles_path.with_suffix(".json.bak")
        bak.write_text(profiles_path.read_text(encoding="utf-8"), encoding="utf-8")
        profiles_path.write_text(json.dumps(result["proposed"], indent=2) + "\n", encoding="utf-8")
        logger.info("patched %s (backup: %s) - %d changes. REVIEW the diff and flip the "
                    "now-measured rules' suspected=True -> False in rule_engine.py.",
                    profiles_path, bak, len(result["changes"]))
    else:
        logger.info("%d proposed changes (dry-run; pass --write to apply)", len(result["changes"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
