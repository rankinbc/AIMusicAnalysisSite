import pytest
from app import source_validation as sv

def test_a_guest_limit_is_enforced(monkeypatch, tmp_path):
    p = tmp_path / "a.wav"; p.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt ")
    monkeypatch.setattr(sv, "_probe_duration", lambda path, fmt: 721.0)
    with pytest.raises(sv.InvalidFileError) as e:
        sv.validate_source(p, max_seconds=720)
    assert e.value.reason_code == sv.REASON_TOO_LONG
    assert "free account" in e.value.message

def test_without_a_limit_the_default_applies(monkeypatch, tmp_path):
    p = tmp_path / "a.wav"; p.write_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt ")
    monkeypatch.setattr(sv, "_probe_duration", lambda path, fmt: 721.0)
    assert sv.validate_source(p) == 721.0
