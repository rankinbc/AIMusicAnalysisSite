"""Offline CLI: run Demucs on each curated reference and cache stem analytics.

Usage:
    python -m audio_analysis.reference_library.pre_demucs \\
        --library data/reference_library/ \\
        --out     data/reference_library/_stems_cache/ \\
        [--track <id>]

Idempotent: skips tracks whose cache file is newer than the source.
Demucs is imported lazily so non-pre-Demucs code paths don't pay the
import cost or require torch to be installed.
"""
import argparse
import json
import logging
import sys
from pathlib import Path

from audio_analysis.stems import analyze
from audio_analysis.stems.types import StemRole

log = logging.getLogger(__name__)

SUPPORTED_EXT = {".wav", ".flac", ".mp3"}


def _run_demucs(src: Path) -> dict[StemRole, Path]:
    """Invoke Demucs and return {role: separated_stem_path}."""
    from demucs.apply import apply_model
    from demucs.audio import AudioFile, save_audio
    from demucs.pretrained import get_model

    model = get_model("htdemucs")
    model.cpu().eval()
    wav = AudioFile(src).read(
        streams=0, samplerate=model.samplerate, channels=model.audio_channels,
    )
    sources = apply_model(model, wav[None], device="cpu")[0]
    out_dir = src.parent / f"_demucs_{src.stem}"
    out_dir.mkdir(exist_ok=True)
    role_map = {
        "vocals": StemRole.VOCALS, "drums": StemRole.DRUMS,
        "bass": StemRole.BASS, "other": StemRole.OTHER,
    }
    paths: dict[StemRole, Path] = {}
    for name, audio in zip(model.sources, sources):
        role = role_map.get(name, StemRole.OTHER)
        out_path = out_dir / f"{name}.wav"
        save_audio(audio, out_path, samplerate=model.samplerate)
        paths[role] = out_path
    return paths


def _analyze_stems(stem_paths: dict[StemRole, Path]) -> dict:
    result = analyze(stem_paths)
    return {
        "per_stem": {
            role.value: {
                "duration_s": m.duration_s,
                "peak_db": m.peak_db, "rms_db": m.rms_db,
                "lufs_integrated": m.lufs_integrated,
                "dynamic_range_db": m.dynamic_range_db,
                "band_energy_db": {b.value: v for b, v in m.band_energy_db.items()},
                "spectral_centroid_hz": m.spectral_centroid_hz,
                "dominant_frequencies_hz": m.dominant_frequencies_hz,
                "stereo_width": m.stereo_width,
                "pan_estimate": m.pan_estimate,
                "is_mono": m.is_mono,
            }
            for role, m in result.per_stem.items()
        },
        "clash_matrix": [
            {
                "stem_a": c.stem_a.value, "stem_b": c.stem_b.value,
                "band": c.band.value, "overlap_severity": c.overlap_severity,
                "severity_tier": c.severity_tier,
            }
            for c in result.clash_matrix
        ],
        "balance_flags": [],  # genre-agnostic at library-build time
    }


def process_reference_library(
    library_dir: Path,
    cache_dir: Path,
    only: str | None = None,
) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    sources = [p for p in library_dir.iterdir() if p.suffix.lower() in SUPPORTED_EXT]
    if only:
        sources = [p for p in sources if p.stem == only]

    for src in sources:
        cache_path = cache_dir / f"{src.stem}.stems.json"
        if cache_path.exists() and cache_path.stat().st_mtime >= src.stat().st_mtime:
            print(f"skip:    {src.name} (cache fresh)")
            continue
        print(f"demucs:  {src.name}")
        stem_paths = _run_demucs(src)
        print(f"analyze: {src.name}")
        payload = _analyze_stems(stem_paths)
        cache_path.write_text(json.dumps(payload, indent=2))
        print(f"wrote:   {cache_path}")


def main() -> int:
    p = argparse.ArgumentParser(prog="pre_demucs")
    p.add_argument("--library", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--track", type=str, default=None)
    args = p.parse_args()
    process_reference_library(args.library, args.out, only=args.track)
    return 0


if __name__ == "__main__":
    sys.exit(main())
