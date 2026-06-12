# components/worker/tests/verdict_pipeline/conftest.py
from __future__ import annotations
import json
import re
from pathlib import Path
import pytest

from app.verdict_lib import prompt_loader

_TRACK_ID_RE = re.compile(r'"track_id"\s*:\s*"([^"]+)"')

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def _no_db_pin_lookups(monkeypatch):
    """Keep this package's tests DB-free and order-independent: stub the
    prompt-pin DB fetch (tests that exercise pins re-monkeypatch it) and
    clear the module-level TTL cache around every test. The real DB path is
    covered by ``tests/test_prompt_pin_db.py`` outside this package."""
    monkeypatch.setattr(prompt_loader, "_fetch_pin_from_db", lambda slug: None)
    prompt_loader.clear_pin_cache()
    yield
    prompt_loader.clear_pin_cache()


def _load_analysis(name: str) -> dict:
    return json.loads((FIXTURES / "analyses" / f"{name}.json").read_text())


@pytest.fixture
def clean_trance() -> dict:
    return _load_analysis("clean_trance")


@pytest.fixture
def muddy_hiphop() -> dict:
    return _load_analysis("muddy_hiphop")


@pytest.fixture
def clipped_pop() -> dict:
    return _load_analysis("clipped_pop")


@pytest.fixture
def mono_broken_indie() -> dict:
    return _load_analysis("mono_broken_indie")


@pytest.fixture
def tiny_dynamics_edm() -> dict:
    return _load_analysis("tiny_dynamics_edm")


class MockLLMClient:
    """Test double for LLMClient. Returns canned responses keyed by
    (system_prompt_excerpt, fixture_track_id). Use `register()` to add
    responses inside individual tests."""

    def __init__(self) -> None:
        self._responses: dict[tuple[str, str], str] = {}
        self.calls: list[dict] = []

    def register(self, prompt_excerpt: str, track_id: str, response: str) -> None:
        self._responses[(prompt_excerpt, track_id)] = response

    async def call(self, system: str, user: str, *, max_tokens: int = 4096,
                   timeout_s: int = 90) -> str:
        match = _TRACK_ID_RE.search(user)
        track_id = match.group(1) if match else "unknown"
        for excerpt, tid in self._responses:
            if excerpt in system and tid == track_id:
                self.calls.append({"system_excerpt": excerpt, "track_id": track_id,
                                   "user": user})
                return self._responses[(excerpt, tid)]
        raise KeyError(f"No mock response for track={track_id}, system={system[:50]!r}")


@pytest.fixture
def llm() -> MockLLMClient:
    return MockLLMClient()
