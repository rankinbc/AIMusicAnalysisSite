"""Tests for the DockerAllin1 wrapper (no real Docker invoked)."""
from __future__ import annotations

import json
import subprocess

import pytest

from audio_analysis.structure.docker_allin1 import (
    Allin1Result,
    Allin1Unavailable,
    DockerAllin1,
)

pytestmark = pytest.mark.uses_docker_wrapper


def _completed(stdout: str = "", stderr: str = "", returncode: int = 0):
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


def test_unavailable_when_no_docker(tmp_path, monkeypatch):
    audio = tmp_path / "song.wav"
    audio.write_bytes(b"RIFF")  # contents irrelevant; analyze() stops before reading

    d = DockerAllin1()
    monkeypatch.setattr(d, "is_docker_available", lambda: False)
    with pytest.raises(Allin1Unavailable):
        d.analyze(audio)


def test_unavailable_when_image_missing(tmp_path, monkeypatch):
    audio = tmp_path / "song.wav"
    audio.write_bytes(b"RIFF")

    d = DockerAllin1()
    monkeypatch.setattr(d, "is_docker_available", lambda: True)
    monkeypatch.setattr(d, "is_image_available", lambda: False)
    with pytest.raises(Allin1Unavailable, match="not found"):
        d.analyze(audio)


def test_parses_container_json(tmp_path, monkeypatch):
    audio = tmp_path / "song.wav"
    audio.write_bytes(b"RIFF")

    payload = {
        "bpm": 128.0,
        "beats": [0.5, 1.0],
        "downbeats": [0.5],
        "segments": [
            {"label": "intro", "start": 0.0, "end": 7.5},
            {"label": "drop", "start": 7.5, "end": 15.0},
        ],
    }
    d = DockerAllin1()
    monkeypatch.setattr(d, "is_docker_available", lambda: True)
    monkeypatch.setattr(d, "is_image_available", lambda: True)
    monkeypatch.setattr(
        DockerAllin1, "_run",
        staticmethod(lambda cmd, *, timeout: _completed(stdout=json.dumps(payload))),
    )

    result = d.analyze(audio)
    assert isinstance(result, Allin1Result)
    assert result.bpm == 128.0
    assert len(result.segments) == 2
    assert result.segments[0].label == "intro"
    assert result.segments[1].end == 15.0


def test_parses_json_amid_progress_noise(tmp_path, monkeypatch):
    audio = tmp_path / "song.wav"
    audio.write_bytes(b"RIFF")

    payload = {"bpm": 120.0, "beats": [], "downbeats": [], "segments": []}
    noisy = (
        "Selected model is a bag of 1 models.\n"
        "Separating track /input/song.wav\n"
        "=> Found 0 tracks already analyzed and 1 tracks to analyze.\n"
        + json.dumps(payload) + "\n"
    )
    d = DockerAllin1()
    monkeypatch.setattr(d, "is_docker_available", lambda: True)
    monkeypatch.setattr(d, "is_image_available", lambda: True)
    monkeypatch.setattr(
        DockerAllin1, "_run",
        staticmethod(lambda cmd, *, timeout: _completed(stdout=noisy)),
    )

    result = d.analyze(audio)
    assert result.bpm == 120.0
    assert result.segments == []


def test_container_nonzero_exit_raises_runtime(tmp_path, monkeypatch):
    audio = tmp_path / "song.wav"
    audio.write_bytes(b"RIFF")

    d = DockerAllin1()
    monkeypatch.setattr(d, "is_docker_available", lambda: True)
    monkeypatch.setattr(d, "is_image_available", lambda: True)
    monkeypatch.setattr(
        DockerAllin1, "_run",
        staticmethod(lambda cmd, *, timeout: _completed(stderr="boom", returncode=1)),
    )

    with pytest.raises(RuntimeError, match="exit 1"):
        d.analyze(audio)
