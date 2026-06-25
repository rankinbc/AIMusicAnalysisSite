"""Docker wrapper for the ``allin1`` music structure analyzer.

Runs allin1 inside a Python 3.11 Linux container (image ``allin1:latest``) so
the worker host — which may be Windows / Python 3.13 — never has to build
madmom/natten natively. The worker calls :meth:`DockerAllin1.analyze`; only the
analyzer runs in the container.

Adapted from ``AbletonAIAnalysis/shared/allin1/docker_allin1.py``: trimmed to
the analyze path the pipeline needs, and switched from ``print`` to ``logging``
so it doesn't pollute worker stdout. Build the image with::

    docker build -t allin1:latest docker/allin1

allin1's JSON shape (start/end in **seconds**)::

    {"bpm": 128.0, "beats": [...], "downbeats": [...],
     "segments": [{"label": "intro", "start": 0.0, "end": 7.5}, ...]}
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

DEFAULT_IMAGE = "allin1:latest"


def _env_truthy(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}

# Python run inside the container. Bypasses the image entrypoint so a CRLF /
# shell quirk in entrypoint.sh can't break us. allin1 (and its demucs
# separation step) prints progress to stdout; redirect that to stderr while it
# runs so ONLY our JSON lands on stdout.
_CONTAINER_SCRIPT = (
    "import sys, json, contextlib, allin1\n"
    "with contextlib.redirect_stdout(sys.stderr):\n"
    "    r = allin1.analyze(sys.argv[1])\n"
    "print(json.dumps({\n"
    "    'bpm': float(r.bpm),\n"
    "    'beats': [float(b) for b in r.beats],\n"
    "    'downbeats': [float(d) for d in r.downbeats],\n"
    "    'segments': [\n"
    "        {'label': s.label, 'start': float(s.start), 'end': float(s.end)}\n"
    "        for s in r.segments\n"
    "    ],\n"
    "}))\n"
)


def _parse_result_json(stdout: str) -> dict:
    """Parse the analyzer's JSON from container stdout.

    The in-container script redirects allin1's chatter to stderr, but parse the
    last JSON-looking line defensively in case any stray line slips through.
    """
    stripped = stdout.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        for line in reversed(stripped.splitlines()):
            line = line.strip()
            if line.startswith("{") and line.endswith("}"):
                return json.loads(line)
        raise


@dataclass
class Allin1Segment:
    """A detected song segment. ``start``/``end`` are in seconds."""
    label: str
    start: float
    end: float


@dataclass
class Allin1Result:
    """Structure-analysis result. ``beats``/``downbeats`` are seconds."""
    bpm: float
    beats: List[float]
    downbeats: List[float]
    segments: List[Allin1Segment]


def structure_dict_from_result(result: "Allin1Result") -> dict:
    """Shape an :class:`Allin1Result` into the Phase-1 ``structure`` sub-dict
    that ``phase1_adapter.adapt`` consumes. Shared by Phase 1 and the background
    ``detect_structure_and_rescore`` helper so the success shape stays in one place.
    """
    return {
        "available": True,
        "detection_method": "allin1-docker",
        "bpm": result.bpm,
        "beats": result.beats,
        "downbeats": result.downbeats,
        "segments": [
            {"label": s.label, "start": s.start, "end": s.end} for s in result.segments
        ],
    }


class Allin1Unavailable(RuntimeError):
    """Raised when Docker or the ``allin1:latest`` image isn't available.

    Distinct from an analysis *failure* so callers can report "structure
    detection isn't set up here" rather than "this track failed".
    """


class DockerAllin1:
    """Run allin1 via ``docker run`` against the ``allin1:latest`` image."""

    def __init__(self, image_name: str | None = None, *, use_gpu: bool | None = None):
        # Prod flips GPU on (CUDA image + nvidia-docker → ~10-15s vs ~60-90s CPU)
        # without a code change: ALLIN1_USE_GPU=1, ALLIN1_IMAGE=allin1:gpu.
        self.image_name = image_name or os.getenv("ALLIN1_IMAGE") or DEFAULT_IMAGE
        self.use_gpu = _env_truthy("ALLIN1_USE_GPU") if use_gpu is None else use_gpu

    # -- availability probes ------------------------------------------------
    @staticmethod
    def _run(cmd: List[str], *, timeout: int) -> subprocess.CompletedProcess:
        return subprocess.run(
            cmd, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=timeout,
        )

    def is_docker_available(self) -> bool:
        try:
            return self._run(["docker", "--version"], timeout=10).returncode == 0
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            return False

    def is_image_available(self) -> bool:
        try:
            out = self._run(["docker", "images", "-q", self.image_name], timeout=10)
            return bool(out.stdout.strip())
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            return False

    def ensure_available(self) -> None:
        """Raise :class:`Allin1Unavailable` with an actionable message if the
        Docker image isn't ready to run."""
        if not self.is_docker_available():
            raise Allin1Unavailable(
                "Docker is not available (CLI missing or daemon down). "
                "Structure detection needs Docker Desktop running."
            )
        if not self.is_image_available():
            raise Allin1Unavailable(
                f"Docker image '{self.image_name}' not found. Build it with: "
                "docker build -t allin1:latest docker/allin1"
            )

    # -- analysis -----------------------------------------------------------
    def analyze(self, audio_path: Path | str, *, timeout: int = 300) -> Allin1Result:
        """Analyze *audio_path* and return an :class:`Allin1Result`.

        Raises :class:`Allin1Unavailable` if Docker/the image isn't ready, and
        ``RuntimeError`` if the container ran but the analysis failed.
        """
        audio_path = Path(audio_path).resolve()
        if not audio_path.exists():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        self.ensure_available()

        cmd = ["docker", "run", "--rm"]
        if self.use_gpu:
            cmd += ["--gpus", "all"]
        cmd += [
            "-v", f"{audio_path.parent}:/input:ro",
            "--entrypoint", "python",
            self.image_name,
            "-c", _CONTAINER_SCRIPT,
            f"/input/{audio_path.name}",
        ]

        try:
            proc = self._run(cmd, timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"allin1 timed out after {timeout}s") from exc
        except (FileNotFoundError, OSError) as exc:  # docker vanished mid-call
            raise Allin1Unavailable(f"Could not invoke docker: {exc}") from exc

        if proc.returncode != 0:
            raise RuntimeError(
                f"allin1 container failed (exit {proc.returncode}): "
                f"{proc.stderr.strip()[:500]}"
            )

        try:
            data = _parse_result_json(proc.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError(
                f"Could not parse allin1 output: {exc}; "
                f"raw: {proc.stdout.strip()[:300]}"
            ) from exc

        return Allin1Result(
            bpm=float(data["bpm"]),
            beats=[float(b) for b in data.get("beats", [])],
            downbeats=[float(d) for d in data.get("downbeats", [])],
            segments=[
                Allin1Segment(label=s["label"], start=float(s["start"]), end=float(s["end"]))
                for s in data.get("segments", [])
            ],
        )
