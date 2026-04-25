from __future__ import annotations
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import AsyncClient, ASGITransport


def _sample_payload(verdict_id: str = "vrd_01HSAMPLE000000000000000000") -> dict:
    return {
        "verdicts": [{
            "verdict_id": verdict_id,
            "track_id": "t1",
            "specialist": "rule_engine",
            "prompt_version": "rule_engine@1.0.0",
            "model": "rules",
            "severity": "moderate",
            "category": "loudness",
            "confidence": 1.0,
            "priority_score": 70,
            "headline": "Sample",
            "summary": "Sample.",
            "evidence": [{"metric": "phase1.integrated_lufs", "value": -10.0,
                          "label": "x"}],
            "fix": None,
            "why_it_matters": "x",
            "related_verdict_ids": [],
            "sources": ["rule_engine"],
            "user_state": {"dismissed": False, "applied": False,
                           "user_modified_fix": None, "feedback": None},
            "created_at": datetime.now(tz=timezone.utc).isoformat(),
        }]
    }


def _mock_user(uid: uuid.UUID | None = None):
    user = MagicMock()
    user.id = uid or uuid.uuid4()
    return user


def _mock_db_with_job(job_id: uuid.UUID, *, verdicts_payload: dict | None,
                      version_set: str | None = None,
                      analysis_final_json: dict | None = None):
    """Build a MagicMock AsyncSession whose execute() returns the right shape
    for `_load_job_for_user`'s SELECT."""
    job = MagicMock()
    job.id = job_id
    result = MagicMock()
    result.verdicts_payload = verdicts_payload
    result.verdicts_prompt_version_set = version_set
    result.final_json = analysis_final_json or {"track_id": str(job_id)}

    row = MagicMock()
    row.UploadJob = job
    row.AnalysisResult = result

    join_result = MagicMock()
    join_result.one_or_none = MagicMock(return_value=row)

    state_scalars = MagicMock()
    state_scalars.scalars = MagicMock(return_value=MagicMock(all=lambda: []))

    db = MagicMock()
    # We need execute() to dispatch by callsite. Both _load_job_for_user (the
    # join) and the user-state SELECT call db.execute exactly once each in get_verdicts.
    # Simplest: return job-row first, then empty state, then anything else.
    responses = iter([join_result, state_scalars])

    async def execute(*_args, **_kwargs):
        try:
            return next(responses)
        except StopIteration:
            return state_scalars
    db.execute = execute
    db.commit = AsyncMock()
    return db


@pytest.fixture
def patched_app():
    """Yield (app, set_db, set_user) for installing dependency overrides."""
    from app.main import app
    from app.routers.auth import get_current_user
    from app.db import get_session
    yield app, get_session, get_current_user
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_verdicts_returns_payload_when_present(patched_app):
    app, get_session, get_current_user = patched_app
    job_id = uuid.uuid4()
    user = _mock_user()
    db = _mock_db_with_job(job_id, verdicts_payload=_sample_payload())

    async def _user(): return user
    async def _session(): yield db
    app.dependency_overrides[get_current_user] = _user
    app.dependency_overrides[get_session] = _session

    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as client:
        r = await client.get(f"/api/reports/{job_id}/verdicts")
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["verdicts"], list)
    assert len(body["verdicts"]) == 1


@pytest.mark.asyncio
async def test_get_verdicts_404_when_not_generated(patched_app):
    app, get_session, get_current_user = patched_app
    job_id = uuid.uuid4()
    user = _mock_user()
    db = _mock_db_with_job(job_id, verdicts_payload=None)

    async def _user(): return user
    async def _session(): yield db
    app.dependency_overrides[get_current_user] = _user
    app.dependency_overrides[get_session] = _session

    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as client:
        r = await client.get(f"/api/reports/{job_id}/verdicts")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_generate_returns_cached_when_payload_exists_and_versions_match(
    patched_app, monkeypatch,
):
    app, get_session, get_current_user = patched_app
    job_id = uuid.uuid4()
    user = _mock_user()
    expected_versions = "fixed-version-set"
    monkeypatch.setattr(
        "app.routers.verdicts._expected_prompt_version_set",
        lambda: expected_versions,
    )
    cached = _sample_payload()
    db = _mock_db_with_job(
        job_id, verdicts_payload=cached, version_set=expected_versions,
    )

    async def _user(): return user
    async def _session(): yield db
    app.dependency_overrides[get_current_user] = _user
    app.dependency_overrides[get_session] = _session

    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as client:
        r = await client.post(f"/api/reports/{job_id}/verdicts/generate")
    assert r.status_code == 200
    assert r.json() == cached


@pytest.mark.asyncio
async def test_generate_returns_202_when_uncached(patched_app, monkeypatch):
    app, get_session, get_current_user = patched_app
    job_id = uuid.uuid4()
    user = _mock_user()
    monkeypatch.setattr(
        "app.routers.verdicts._expected_prompt_version_set",
        lambda: "fixed-version-set",
    )
    monkeypatch.setattr(
        "app.routers.verdicts._run_and_persist",
        AsyncMock(return_value=None),
    )
    db = _mock_db_with_job(job_id, verdicts_payload=None)

    async def _user(): return user
    async def _session(): yield db
    app.dependency_overrides[get_current_user] = _user
    app.dependency_overrides[get_session] = _session

    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as client:
        r = await client.post(f"/api/reports/{job_id}/verdicts/generate")
    assert r.status_code == 202
    assert "generation_id" in r.json()


@pytest.mark.asyncio
async def test_feedback_validates_kind(patched_app):
    app, get_session, get_current_user = patched_app
    user = _mock_user()
    job_id = uuid.uuid4()
    verdict_id = "vrd_01HSAMPLE000000000000000000"

    # `_job_id_for_verdict` calls db.execute once and walks results to find verdict.
    # Build a row matching the user/verdict.
    arow = MagicMock()
    arow.verdicts_payload = {"verdicts": [{"verdict_id": verdict_id}]}
    db = MagicMock()

    async def execute(*_args, **_kwargs):
        result = MagicMock()
        result.all = MagicMock(return_value=[(arow, job_id)])
        return result

    db.execute = execute
    db.commit = AsyncMock()

    async def _user(): return user
    async def _session(): yield db
    app.dependency_overrides[get_current_user] = _user
    app.dependency_overrides[get_session] = _session

    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as client:
        bad = await client.post(
            f"/api/verdicts/{verdict_id}/feedback", json={"feedback": "garbage"}
        )
        assert bad.status_code == 422
        good = await client.post(
            f"/api/verdicts/{verdict_id}/feedback", json={"feedback": "helpful"}
        )
        assert good.status_code == 204


@pytest.mark.asyncio
async def test_dismiss_writes_user_state(patched_app):
    app, get_session, get_current_user = patched_app
    user = _mock_user()
    job_id = uuid.uuid4()
    verdict_id = "vrd_01HSAMPLE000000000000000000"

    arow = MagicMock()
    arow.verdicts_payload = {"verdicts": [{"verdict_id": verdict_id}]}
    db = MagicMock()

    async def execute(*_args, **_kwargs):
        result = MagicMock()
        result.all = MagicMock(return_value=[(arow, job_id)])
        return result

    db.execute = execute
    db.commit = AsyncMock()

    async def _user(): return user
    async def _session(): yield db
    app.dependency_overrides[get_current_user] = _user
    app.dependency_overrides[get_session] = _session

    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as client:
        r = await client.post(f"/api/verdicts/{verdict_id}/dismiss")
    assert r.status_code == 204


@pytest.mark.asyncio
async def test_other_users_verdicts_404(patched_app):
    """If the join (filtered by user_id) returns nothing, route returns 404 not 403."""
    app, get_session, get_current_user = patched_app
    job_id = uuid.uuid4()
    user = _mock_user()

    join_result = MagicMock()
    join_result.one_or_none = MagicMock(return_value=None)
    db = MagicMock()

    async def execute(*_args, **_kwargs):
        return join_result

    db.execute = execute
    db.commit = AsyncMock()

    async def _user(): return user
    async def _session(): yield db
    app.dependency_overrides[get_current_user] = _user
    app.dependency_overrides[get_session] = _session

    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as client:
        r = await client.get(f"/api/reports/{job_id}/verdicts")
    assert r.status_code == 404
