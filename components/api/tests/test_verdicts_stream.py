from __future__ import annotations
import json
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient, ASGITransport


@pytest.fixture
def patched_app():
    from app.main import app
    from app.routers.auth import get_current_user_sse
    from app.db import get_session
    yield app, get_session, get_current_user_sse
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_stream_emits_complete_event(patched_app, monkeypatch):
    """SSE endpoint streams events, ending with `event: complete`.
    Pipeline is mocked to produce a deterministic single-event sequence."""
    app, get_session, get_current_user_sse = patched_app
    job_id = uuid.uuid4()
    user = MagicMock()
    user.id = uuid.uuid4()

    job = MagicMock()
    job.id = job_id
    result_row = MagicMock()
    result_row.final_json = {"track_id": str(job_id), "phase1": {}}
    row = MagicMock()
    row.UploadJob = job
    row.AnalysisResult = result_row

    join_result = MagicMock()
    join_result.one_or_none = MagicMock(return_value=row)

    db = MagicMock()

    async def execute(*_a, **_kw):
        return join_result

    db.execute = execute
    db.commit = AsyncMock()

    async def fake_pipeline(analysis, **_kwargs):
        from app.verdict_pipeline.orchestrator import PipelineEvent
        yield PipelineEvent(kind="rule-verdict", payload={"v": "rule"})
        yield PipelineEvent(
            kind="complete",
            payload={"verdicts": [], "verdict_count": 0,
                     "prompt_versions": "", "model": "claude-cli"},
        )

    monkeypatch.setattr("app.routers.verdicts.run_pipeline", fake_pipeline)
    monkeypatch.setattr(
        "app.routers.verdicts._expected_prompt_version_set",
        lambda: "fixed",
    )

    async def _user(): return user
    async def _session(): yield db
    app.dependency_overrides[get_current_user_sse] = _user
    app.dependency_overrides[get_session] = _session

    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as client:
        async with client.stream(
            "GET", f"/api/reports/{job_id}/verdicts/stream",
        ) as r:
            assert r.status_code == 200
            assert "text/event-stream" in r.headers["content-type"]
            text = ""
            async for chunk in r.aiter_text():
                text += chunk
                if "event: complete" in text:
                    break
    assert "event: rule-verdict" in text
    assert "event: complete" in text
