from __future__ import annotations
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient, ASGITransport


@pytest.fixture
def patched_app():
    from app.main import app
    from app.db import get_session
    yield app, get_session
    app.dependency_overrides.clear()


def _mock_db_for_share(analysis_row):
    db = MagicMock()
    select_result = MagicMock()
    select_result.scalar_one_or_none = MagicMock(return_value=analysis_row)

    async def execute(*_a, **_kw):
        return select_result
    db.execute = execute
    return db


@pytest.mark.asyncio
async def test_share_includes_verdicts_strips_user_state(patched_app):
    app, get_session = patched_app
    token = "share-tok-1"
    analysis = MagicMock()
    analysis.final_json = {"track_id": "t1"}
    analysis.verdicts_payload = {"verdicts": [{
        "verdict_id": "vrd_x",
        "user_state": {"dismissed": True, "applied": True,
                       "user_modified_fix": {"foo": 1}, "feedback": "wrong"},
    }]}
    db = _mock_db_for_share(analysis)

    async def _session(): yield db
    app.dependency_overrides[get_session] = _session

    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as client:
        r = await client.get(f"/reports/share/{token}")
    assert r.status_code == 200
    body = r.json()
    assert "verdicts" in body
    assert len(body["verdicts"]) == 1
    # user_state must be stripped to defaults
    assert body["verdicts"][0]["user_state"] == {
        "dismissed": False, "applied": False,
        "user_modified_fix": None, "feedback": None,
    }


@pytest.mark.asyncio
async def test_share_returns_empty_verdicts_when_payload_null(patched_app):
    app, get_session = patched_app
    analysis = MagicMock()
    analysis.final_json = {"track_id": "t1"}
    analysis.verdicts_payload = None
    db = _mock_db_for_share(analysis)

    async def _session(): yield db
    app.dependency_overrides[get_session] = _session

    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as client:
        r = await client.get("/reports/share/some-token")
    assert r.status_code == 200
    assert r.json()["verdicts"] == []
