import json
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import AsyncMock, patch, MagicMock


FAKE_ANALYSIS = {"audio_analysis": {"bpm": 138, "loudness": {"integrated_lufs": -10.0}}}


@pytest.mark.asyncio
async def test_triage_returns_structured_response(tmp_path, monkeypatch):
    """POST /experts/{job_id}/triage returns text + recommended_specialists."""
    results_dir = tmp_path / "results"
    results_dir.mkdir()
    (results_dir / "job-1.json").write_text(json.dumps(FAKE_ANALYSIS))

    monkeypatch.setattr("app.routers.experts.RESULTS_DIR", results_dir)

    with (
        patch(
            "app.routers.experts._fetch_job_and_result",
            AsyncMock(return_value=(object(), object())),
        ),
        patch(
            "app.routers.experts.run_triage",
            AsyncMock(
                return_value={
                    "text": "1. LowEnd.md [PRIORITY: CRITICAL]",
                    "recommended_specialists": ["LowEnd"],
                }
            ),
        ),
    ):
        from app.main import app
        from app.routers.auth import get_current_user
        from app.db import get_session

        async def mock_user():
            return MagicMock()

        async def mock_session():
            yield MagicMock()

        app.dependency_overrides[get_current_user] = mock_user
        app.dependency_overrides[get_session] = mock_session
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post("/experts/job-1/triage")
        finally:
            app.dependency_overrides.clear()

    assert resp.status_code == 200
    body = resp.json()
    assert "text" in body
    assert body["recommended_specialists"] == ["LowEnd"]


@pytest.mark.asyncio
async def test_specialist_invalid_name_returns_400():
    """POST /experts/{job_id}/specialist/BadName returns 400."""
    from app.main import app
    from app.routers.auth import get_current_user
    from app.db import get_session

    async def mock_user():
        return MagicMock()

    async def mock_session():
        yield MagicMock()

    app.dependency_overrides[get_current_user] = mock_user
    app.dependency_overrides[get_session] = mock_session
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post("/experts/job-1/specialist/BadName")
    finally:
        app.dependency_overrides.clear()

    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_specialist_streams_sse(tmp_path, monkeypatch):
    """POST /experts/{job_id}/specialist/LowEnd returns SSE chunks."""
    results_dir = tmp_path / "results"
    results_dir.mkdir()
    (results_dir / "job-1.json").write_text(json.dumps(FAKE_ANALYSIS))

    monkeypatch.setattr("app.routers.experts.RESULTS_DIR", results_dir)

    async def fake_stream(*args, **kwargs):
        yield {"event": "chunk", "data": json.dumps({"text": "Hello"})}
        yield {"event": "done", "data": "{}"}

    with (
        patch(
            "app.routers.experts._fetch_job_and_result",
            AsyncMock(return_value=(object(), object())),
        ),
        patch(
            "app.routers.experts.stream_specialist",
            fake_stream,
        ),
    ):
        from app.main import app
        from app.routers.auth import get_current_user
        from app.db import get_session

        async def mock_user():
            return MagicMock()

        async def mock_session():
            yield MagicMock()

        app.dependency_overrides[get_current_user] = mock_user
        app.dependency_overrides[get_session] = mock_session
        try:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/experts/job-1/specialist/LowEnd",
                    headers={"Accept": "text/event-stream"},
                )
        finally:
            app.dependency_overrides.clear()

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
