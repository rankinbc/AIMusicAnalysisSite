import io

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
async def client():
    from app.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac


class TestMagicBytes:
    """Pure-unit tests for the magic byte validator — no I/O."""

    def test_mp3_ff_fb(self):
        from app.routers.uploads import validate_audio_magic

        assert validate_audio_magic(b"\xff\xfb" + b"\x00" * 10) is True

    def test_mp3_id3(self):
        from app.routers.uploads import validate_audio_magic

        assert validate_audio_magic(b"ID3\x00some data") is True

    def test_flac(self):
        from app.routers.uploads import validate_audio_magic

        assert validate_audio_magic(b"fLaC\x00\x00\x00\x22") is True

    def test_wav_riff(self):
        from app.routers.uploads import validate_audio_magic

        assert validate_audio_magic(b"RIFF\x00\x00\x00\x00WAVEfmt ") is True

    def test_invalid_header(self):
        from app.routers.uploads import validate_audio_magic

        assert validate_audio_magic(b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b") is False

    def test_empty_header(self):
        from app.routers.uploads import validate_audio_magic

        assert validate_audio_magic(b"") is False

    def test_too_short_header(self):
        from app.routers.uploads import validate_audio_magic

        # Single byte — shouldn't match anything (and shouldn't crash)
        assert validate_audio_magic(b"\xff") is False


class TestUploadAuth:
    async def test_upload_requires_auth(self, client):
        """Upload without bearer token must return 401."""
        mp3_content = b"\xff\xfb" + b"\x00" * 100
        files = {"file": ("test.mp3", io.BytesIO(mp3_content), "audio/mpeg")}
        response = await client.post("/uploads/", files=files)
        assert response.status_code == 401

    async def test_upload_invalid_magic_bytes(self, client):
        """Upload with a valid token but invalid magic bytes must return 415."""
        import uuid
        from unittest.mock import AsyncMock, MagicMock

        from app.db import get_session
        from app.main import app
        from app.models import User
        from app.routers.auth import get_current_user

        fake_user = User(
            id=uuid.uuid4(),
            email="user@example.com",
            hashed_password="hashed",
        )

        async def mock_current_user():
            return fake_user

        async def mock_session_dep():
            yield AsyncMock()

        app.dependency_overrides[get_current_user] = mock_current_user
        app.dependency_overrides[get_session] = mock_session_dep
        try:
            bad_content = b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b"
            files = {"file": ("bad.bin", io.BytesIO(bad_content), "application/octet-stream")}
            response = await client.post("/uploads/", files=files)
            assert response.status_code == 415
        finally:
            app.dependency_overrides.clear()
