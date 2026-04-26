import pytest

from app.services.stem_validation import (
    MAX_STEM_FILES, MAX_PER_FILE_BYTES,
    StemValidationError, validate_stem_uploads,
)


class _Upload:
    def __init__(self, filename: str, payload: bytes):
        self.filename, self.payload = filename, payload
        self.size = len(payload)


FLAC_MAGIC = b"fLaC" + b"\x00" * 100
WAV_MAGIC = b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 100


def test_accepts_4_flac_stems():
    uploads = [_Upload(f"0{i}_stem.flac", FLAC_MAGIC) for i in range(1, 5)]
    validate_stem_uploads(uploads)


def test_rejects_too_many_files():
    uploads = [_Upload(f"s{i}.flac", FLAC_MAGIC) for i in range(MAX_STEM_FILES + 1)]
    with pytest.raises(StemValidationError) as exc:
        validate_stem_uploads(uploads)
    assert exc.value.code == "stem_count_out_of_range"


def test_rejects_zero_files():
    with pytest.raises(StemValidationError) as exc:
        validate_stem_uploads([])
    assert exc.value.code == "stem_count_out_of_range"


def test_rejects_oversized_file():
    big = _Upload("big.flac", FLAC_MAGIC + b"\x00" * (MAX_PER_FILE_BYTES + 1))
    with pytest.raises(StemValidationError) as exc:
        validate_stem_uploads([big])
    assert exc.value.code == "stem_file_too_large"


def test_rejects_total_over_limit():
    # Each file just under the per-file cap; 15 of them sum well over 1 GB.
    chunk = MAX_PER_FILE_BYTES - len(FLAC_MAGIC) - 1
    uploads = [_Upload(f"s{i}.flac", FLAC_MAGIC + b"\x00" * chunk) for i in range(15)]
    with pytest.raises(StemValidationError) as exc:
        validate_stem_uploads(uploads)
    assert exc.value.code == "total_upload_too_large"


def test_rejects_mp3_disguised_as_flac():
    uploads = [_Upload("fake.flac", b"ID3\x03" + b"\x00" * 100)]
    with pytest.raises(StemValidationError) as exc:
        validate_stem_uploads(uploads)
    assert exc.value.code == "unsupported_stem_format"


def test_accepts_wav_by_magic():
    uploads = [_Upload("ok.wav", WAV_MAGIC)]
    validate_stem_uploads(uploads)
