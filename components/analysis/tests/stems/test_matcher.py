from pathlib import Path

import pytest

from audio_analysis.stems.matcher import propose_mapping, validate_confirmed_mapping
from audio_analysis.stems.types import ConfirmedMapping, StemRole


def test_propose_with_als_track_names(synth_stems_dir: Path):
    files = sorted(synth_stems_dir.glob("*.flac"))
    als_tracks = ["Kick", "Bass", "Hats", "Lead Vox"]
    proposals = propose_mapping(files, als_tracks)
    by_file = {p.file.name: p for p in proposals}
    assert by_file["01_Kick.flac"].proposed_role == StemRole.KICK
    assert by_file["01_Kick.flac"].proposed_als_track == "Kick"
    assert by_file["04_Vox.flac"].proposed_als_track == "Lead Vox"


def test_propose_without_als_uses_filename(synth_stems_dir: Path):
    files = sorted(synth_stems_dir.glob("*.flac"))
    proposals = propose_mapping(files, als_track_names=None)
    by_file = {p.file.name: p for p in proposals}
    assert by_file["02_Bass.flac"].proposed_role == StemRole.BASS
    assert all(p.proposed_als_track is None for p in proposals)


def test_validate_passes_with_unique_roles(tmp_path: Path):
    a = tmp_path / "a.flac"; a.write_bytes(b"")
    b = tmp_path / "b.flac"; b.write_bytes(b"")
    mappings = [
        ConfirmedMapping(a, StemRole.DRUMS, None),
        ConfirmedMapping(b, StemRole.BASS, None),
    ]
    validate_confirmed_mapping(mappings)


def test_validate_allows_duplicate_roles(tmp_path: Path):
    # Bulk upload supports many stems per role (summed into a role bus).
    a = tmp_path / "a.flac"; a.write_bytes(b"")
    b = tmp_path / "b.flac"; b.write_bytes(b"")
    mappings = [
        ConfirmedMapping(a, StemRole.BASS, None),
        ConfirmedMapping(b, StemRole.BASS, None),
    ]
    validate_confirmed_mapping(mappings)  # no raise


def test_validate_rejects_missing_file(tmp_path: Path):
    mappings = [ConfirmedMapping(tmp_path / "nope.flac", StemRole.BASS, None)]
    with pytest.raises(ValueError, match="missing_file"):
        validate_confirmed_mapping(mappings)
