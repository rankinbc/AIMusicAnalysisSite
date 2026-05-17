"""Integration tests for POST /reports/{job_id}/verdicts/run/{slug}."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Iterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


# ── Test LLM double ──────────────────────────────────────────────────────────

class _FakeLLM:
    """Minimal LLMClient stand-in. Returns canned responses in order; raises
    after the queue is exhausted."""

    def __init__(self, responses: list[str] | None = None) -> None:
        self._queue: Iterator[str] = iter(responses or [])
        self.calls: list[dict] = []

    async def call(self, *, system: str, user: str,
                   max_tokens: int = 4096, timeout_s: int = 90) -> str:
        self.calls.append({"system": system[:80], "user_len": len(user),
                           "timeout_s": timeout_s})
        try:
            return next(self._queue)
        except StopIteration:
            raise RuntimeError("fake LLM exhausted")


def _canned_low_end_payload(headline: str = "Mud at 250Hz") -> str:
    """A response the validator will accept against the seeded final_json
    (phase3.low_mid_energy = 0.31). evidence value matches within tolerance."""
    return json.dumps({
        "specialist": "low_end",
        "verdicts": [{
            "severity": "moderate",
            "category": "low_end",
            "confidence": 0.8,
            "headline": headline,
            "summary": "Kick and bass compete in low-mid range.",
            "evidence": [{
                "metric": "phase3.low_mid_energy",
                "value": 0.31,
                "label": "low-mid energy",
            }],
            "fix": None,
            "why_it_matters": "Loses punch on club systems.",
        }],
    })


def _canned_loudness_payload() -> str:
    return json.dumps({
        "specialist": "loudness",
        "verdicts": [{
            "severity": "moderate",
            "category": "loudness",
            "confidence": 0.7,
            "headline": "Over-loud for streaming",
            "summary": "Integrated LUFS hot for Spotify target.",
            "evidence": [{
                "metric": "phase1.integrated_lufs",
                "value": -9.0,
                "label": "integrated LUFS",
            }],
            "fix": None,
            "why_it_matters": "Spotify will turn this down −5 dB.",
        }],
    })


SEEDED_FINAL_JSON: dict = {
    "track_id": "fixture-route-test",
    "phase1": {
        "duration_seconds": 220.0,
        "integrated_lufs": -9.0,
        "true_peak_db": -1.5,
        "clipping_detected": False,
        "bpm": 92.0,
    },
    "phase3": {"low_mid_energy": 0.31},
}


# ── Fixture: authed client + real sqlite session + seeded job ────────────────

@pytest.fixture
async def authed_route_client():
    """Yields (client, session_factory, user) with:
    - in-memory sqlite (via async engine, JSONB-compile shim from conftest)
    - get_current_user override returning a seeded user
    - _get_llm_client override returning a freshly-installed _FakeLLM
      (callers can swap client.fake_llm before each test)
    """
    from aimusic_shared.models import Base, User
    from app.db import get_session
    from app.main import app
    from app.routers.auth import get_current_user
    from app.routers.verdicts import _get_llm_client

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    user = User(id=uuid.uuid4(), email=f"u{uuid.uuid4()}@x.com",
                hashed_password="hash")

    async def _override_session():
        async with Session() as s:
            yield s

    fake_llm = _FakeLLM()

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[_get_llm_client] = lambda: fake_llm

    async with Session() as s:
        s.add(user)
        await s.commit()

    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        ac.user = user  # type: ignore[attr-defined]
        ac.session_factory = Session  # type: ignore[attr-defined]
        ac.fake_llm = fake_llm  # type: ignore[attr-defined]
        yield ac

    app.dependency_overrides.clear()
    await engine.dispose()


async def _seed_job_with_results(
    session_factory,
    user_id: uuid.UUID,
    *,
    final_json: dict | None = None,
    verdicts_payload: dict | None = None,
    verdicts_prompt_version_set: str | None = None,
) -> uuid.UUID:
    """Insert a COMPLETE UploadJob + AnalysisResult; return job_id."""
    from aimusic_shared.models import AnalysisResult, JobStatus, UploadJob

    async with session_factory() as s:
        job = UploadJob(
            id=uuid.uuid4(), user_id=user_id, status=JobStatus.COMPLETE,
            file_path="/tmp/test.wav",
        )
        s.add(job)
        await s.flush()
        result = AnalysisResult(
            job_id=job.id,
            phase_results=[],
            final_json=final_json if final_json is not None else SEEDED_FINAL_JSON,
            share_token=str(uuid.uuid4()),
            verdicts_payload=verdicts_payload,
            verdicts_prompt_version_set=verdicts_prompt_version_set,
        )
        s.add(result)
        await s.commit()
        return job.id


async def _read_result(session_factory, job_id: uuid.UUID):
    from sqlalchemy import select
    from aimusic_shared.models import AnalysisResult

    async with session_factory() as s:
        return (await s.execute(
            select(AnalysisResult).where(AnalysisResult.job_id == job_id)
        )).scalar_one()


# ── Tests ────────────────────────────────────────────────────────────────────

class TestRunSpecialist:
    async def test_happy_path_returns_verdicts(self, authed_route_client):
        job_id = await _seed_job_with_results(
            authed_route_client.session_factory, authed_route_client.user.id,
        )
        authed_route_client.fake_llm._queue = iter([_canned_low_end_payload()])
        r = await authed_route_client.post(
            f"/reports/{job_id}/verdicts/run/low_end"
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["specialist"] == "low_end"
        assert body["prompt_version"].startswith("low_end@")
        assert len(body["verdicts"]) == 1
        assert body["verdicts"][0]["specialist"] == "low_end"
        assert body["validation_failures"] == []

    async def test_unknown_specialist_404(self, authed_route_client):
        job_id = await _seed_job_with_results(
            authed_route_client.session_factory, authed_route_client.user.id,
        )
        r = await authed_route_client.post(
            f"/reports/{job_id}/verdicts/run/no_such_specialist"
        )
        assert r.status_code == 404
        assert r.json()["detail"] == "unknown specialist"

    async def test_other_user_job_404(self, authed_route_client):
        from aimusic_shared.models import User
        from app.main import app
        from app.routers.auth import get_current_user
        job_id = await _seed_job_with_results(
            authed_route_client.session_factory, authed_route_client.user.id,
        )
        # Switch the current user to someone who doesn't own this job.
        other = User(id=uuid.uuid4(), email=f"x{uuid.uuid4()}@x.com",
                     hashed_password="h")
        async with authed_route_client.session_factory() as s:
            s.add(other); await s.commit()
        app.dependency_overrides[get_current_user] = lambda: other
        try:
            r = await authed_route_client.post(
                f"/reports/{job_id}/verdicts/run/low_end"
            )
            assert r.status_code == 404
        finally:
            app.dependency_overrides[get_current_user] = lambda: authed_route_client.user

    async def test_no_final_json_410(self, authed_route_client):
        # Seed a job with empty final_json (analysis incomplete).
        from aimusic_shared.models import AnalysisResult, JobStatus, UploadJob
        async with authed_route_client.session_factory() as s:
            job = UploadJob(
                id=uuid.uuid4(), user_id=authed_route_client.user.id,
                status=JobStatus.PROCESSING, file_path="/tmp/x.wav",
            )
            s.add(job); await s.flush()
            s.add(AnalysisResult(
                job_id=job.id, phase_results=[], final_json={},
                share_token=str(uuid.uuid4()),
            ))
            await s.commit()
            jid = job.id
        r = await authed_route_client.post(
            f"/reports/{jid}/verdicts/run/low_end"
        )
        assert r.status_code == 410
        assert r.json()["detail"] == "analysis not complete"

    async def test_replace_not_duplicate(self, authed_route_client):
        job_id = await _seed_job_with_results(
            authed_route_client.session_factory, authed_route_client.user.id,
        )
        # Two runs, each returning one low_end verdict.
        authed_route_client.fake_llm._queue = iter([
            _canned_low_end_payload("First low_end"),
            _canned_low_end_payload("Second low_end"),
        ])
        await authed_route_client.post(f"/reports/{job_id}/verdicts/run/low_end")
        await authed_route_client.post(f"/reports/{job_id}/verdicts/run/low_end")
        result = await _read_result(authed_route_client.session_factory, job_id)
        low_end_verdicts = [v for v in result.verdicts_payload["verdicts"]
                            if v["specialist"] == "low_end"]
        assert len(low_end_verdicts) == 1
        assert low_end_verdicts[0]["headline"] == "Second low_end"

    async def test_preserves_other_specialists_verdicts(self, authed_route_client):
        # Pre-seed the payload with a foreign-specialist verdict that the new
        # run should NOT touch.
        existing_other = {
            "verdicts": [{
                "verdict_id": "vrd_01HSAMPLEFOREIGN00000000000",
                "track_id": SEEDED_FINAL_JSON["track_id"],
                "specialist": "loudness",
                "prompt_version": "loudness@1.0.0",
                "model": "claude-cli",
                "severity": "moderate",
                "category": "loudness",
                "confidence": 0.7,
                "priority_score": 70,
                "headline": "Pre-existing loudness verdict",
                "summary": "x",
                "evidence": [{"metric": "phase1.integrated_lufs",
                              "value": -9.0, "label": "lufs"}],
                "fix": None,
                "why_it_matters": "x",
                "related_verdict_ids": [],
                "sources": ["loudness"],
                "user_state": {"dismissed": False, "applied": False,
                               "user_modified_fix": None, "feedback": None},
                "created_at": datetime.now(tz=timezone.utc).isoformat(),
            }]
        }
        job_id = await _seed_job_with_results(
            authed_route_client.session_factory, authed_route_client.user.id,
            verdicts_payload=existing_other,
        )
        authed_route_client.fake_llm._queue = iter([_canned_low_end_payload()])
        r = await authed_route_client.post(
            f"/reports/{job_id}/verdicts/run/low_end"
        )
        assert r.status_code == 200, r.text
        result = await _read_result(authed_route_client.session_factory, job_id)
        slugs = {v["specialist"] for v in result.verdicts_payload["verdicts"]}
        assert slugs == {"loudness", "low_end"}

    async def test_clears_prompt_version_set(self, authed_route_client):
        job_id = await _seed_job_with_results(
            authed_route_client.session_factory, authed_route_client.user.id,
            verdicts_prompt_version_set="batch-version-marker",
        )
        authed_route_client.fake_llm._queue = iter([_canned_low_end_payload()])
        await authed_route_client.post(
            f"/reports/{job_id}/verdicts/run/low_end"
        )
        result = await _read_result(authed_route_client.session_factory, job_id)
        assert result.verdicts_prompt_version_set is None

    async def test_validation_failure_returns_200_with_failures(
        self, authed_route_client,
    ):
        # Return a verdict whose evidence path doesn't resolve in final_json
        # → validator rejects → route returns 200 with failures.
        bad = json.dumps({
            "specialist": "low_end",
            "verdicts": [{
                "severity": "moderate",
                "category": "low_end",
                "confidence": 0.8,
                "headline": "Bad metric path",
                "summary": "Evidence references missing metric.",
                "evidence": [{
                    "metric": "phase9.does_not_exist",
                    "value": 0.5,
                    "label": "x",
                }],
                "fix": None,
                "why_it_matters": "x",
            }],
        })
        job_id = await _seed_job_with_results(
            authed_route_client.session_factory, authed_route_client.user.id,
        )
        authed_route_client.fake_llm._queue = iter([bad])
        r = await authed_route_client.post(
            f"/reports/{job_id}/verdicts/run/low_end"
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["verdicts"] == []
        assert len(body["validation_failures"]) == 1
        assert "does not resolve" in body["validation_failures"][0]["reason"]

    async def test_updates_verdicts_generated_at(self, authed_route_client):
        job_id = await _seed_job_with_results(
            authed_route_client.session_factory, authed_route_client.user.id,
        )
        authed_route_client.fake_llm._queue = iter([_canned_low_end_payload()])
        before = datetime.now(tz=timezone.utc)
        await authed_route_client.post(
            f"/reports/{job_id}/verdicts/run/low_end"
        )
        result = await _read_result(authed_route_client.session_factory, job_id)
        assert result.verdicts_generated_at is not None
        # Tolerant on tz-naivety from sqlite roundtrips.
        ts = result.verdicts_generated_at
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        assert ts >= before.replace(microsecond=0)
