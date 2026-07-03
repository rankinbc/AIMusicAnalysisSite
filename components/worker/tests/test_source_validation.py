"""Story 3.2 (AR19) — source validation at the worker trust boundary."""
from __future__ import annotations

import os
import struct
import uuid
import wave

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from app import source_validation as sv  # noqa: E402


def _write_wav(path, seconds: float = 5.0, rate: int = 8000) -> None:
    frames = int(seconds * rate)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack(f"<{frames}h", *([0] * frames)))


def test_valid_wav_passes_and_returns_duration(tmp_path):
    p = tmp_path / "ok.wav"
    _write_wav(p, seconds=5.0)
    assert sv.validate_source(p) == pytest.approx(5.0, abs=0.1)


def test_junk_bytes_fail_with_bad_magic(tmp_path):
    p = tmp_path / "spoof.wav"
    p.write_bytes(b"#!/bin/sh\necho pwned\n" + b"\x00" * 64)
    with pytest.raises(sv.InvalidFileError) as e:
        sv.validate_source(p)
    assert e.value.reason_code == sv.REASON_BAD_MAGIC


def test_truncated_header_fails(tmp_path):
    p = tmp_path / "tiny.wav"
    p.write_bytes(b"RIFF")
    with pytest.raises(sv.InvalidFileError) as e:
        sv.validate_source(p)
    assert e.value.reason_code == sv.REASON_BAD_MAGIC


def test_wav_magic_with_garbage_body_is_undecodable(tmp_path):
    p = tmp_path / "hollow.wav"
    p.write_bytes(b"RIFF\x24\x00\x00\x00WAVE" + b"\x00" * 32)
    with pytest.raises(sv.InvalidFileError) as e:
        sv.validate_source(p)
    assert e.value.reason_code == sv.REASON_UNDECODABLE


def test_too_short_and_too_long_reason_codes(tmp_path, monkeypatch):
    p = tmp_path / "len.wav"
    _write_wav(p, seconds=5.0)

    monkeypatch.setenv("MIN_AUDIO_DURATION_SECONDS", "10")
    with pytest.raises(sv.InvalidFileError) as e:
        sv.validate_source(p)
    assert e.value.reason_code == sv.REASON_TOO_SHORT

    monkeypatch.setenv("MIN_AUDIO_DURATION_SECONDS", "1")
    monkeypatch.setenv("MAX_AUDIO_DURATION_SECONDS", "2")
    with pytest.raises(sv.InvalidFileError) as e:
        sv.validate_source(p)
    assert e.value.reason_code == sv.REASON_TOO_LONG


def test_missing_file_is_not_a_user_error(tmp_path):
    # OS-level read failures propagate as-is (job should retry, not refund).
    with pytest.raises(FileNotFoundError):
        sv.validate_source(tmp_path / f"{uuid.uuid4()}.wav")


def test_environment_errors_are_not_invalid_file(tmp_path, monkeypatch):
    """A broken worker (missing decoder, disk I/O) must NOT refund-and-reject
    the upload as invalid_file — it propagates to the retrying failure arm."""
    import soundfile

    p = tmp_path / "ok.wav"
    _write_wav(p, seconds=5.0)

    def _io_boom(_path):
        raise OSError("disk exploded")

    monkeypatch.setattr(soundfile, "info", _io_boom)
    with pytest.raises(OSError):
        sv.validate_source(p)


def test_ff_junk_with_reserved_bits_does_not_pass_as_mp3():
    # 0xFF followed by reserved version/layer bits is NOT a valid MPEG frame.
    assert sv._sniff_magic(b"\xff\xe1\x00\x00" + b"\x00" * 12) is None  # layer=00 reserved
    assert sv._sniff_magic(b"\xff\xeb\x00\x00" + b"\x00" * 12) is None  # version=01 reserved


def test_magic_table_recognizes_other_formats():
    assert sv._sniff_magic(b"fLaC" + b"\x00" * 12) == "flac"
    assert sv._sniff_magic(b"ID3\x04" + b"\x00" * 12) == "mp3"
    assert sv._sniff_magic(b"\xff\xfb\x90\x00" + b"\x00" * 12) == "mp3"
    assert sv._sniff_magic(b"OggS" + b"\x00" * 12) == "ogg"
    assert sv._sniff_magic(b"FORM\x00\x00\x00\x00AIFF" + b"\x00" * 4) == "aiff"
    assert sv._sniff_magic(b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 4) == "m4a"
    assert sv._sniff_magic(b"PK\x03\x04" + b"\x00" * 12) is None  # zip
