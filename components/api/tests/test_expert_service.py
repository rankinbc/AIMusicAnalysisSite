import json
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.expert_service import (
    load_prompt,
    extract_recommended_specialists,
    VALID_SPECIALISTS,
)


def test_load_prompt_returns_string(tmp_path, monkeypatch):
    """load_prompt reads the correct .md file."""
    fake_prompts = tmp_path / "experts"
    fake_prompts.mkdir()
    (fake_prompts / "LowEnd.md").write_text("# Low End Specialist\nContent here.")

    monkeypatch.setattr("app.services.expert_service.PROMPTS_DIR", fake_prompts)

    result = load_prompt("LowEnd")
    assert result == "# Low End Specialist\nContent here."


def test_load_prompt_missing_raises(tmp_path, monkeypatch):
    """load_prompt raises FileNotFoundError for unknown specialist."""
    fake_prompts = tmp_path / "experts"
    fake_prompts.mkdir()

    monkeypatch.setattr("app.services.expert_service.PROMPTS_DIR", fake_prompts)

    with pytest.raises(FileNotFoundError):
        load_prompt("NonExistent")


def test_extract_recommended_specialists_finds_names():
    """Parses specialist names from triage output."""
    triage_text = """
RUN THESE SPECIALISTS
1. LowEnd.md [PRIORITY: CRITICAL]
2. Dynamics.md [PRIORITY: SEVERE]
3. Sections.md [PRIORITY: MODERATE]
"""
    result = extract_recommended_specialists(triage_text)
    assert result == ["LowEnd", "Dynamics", "Sections"]


def test_extract_recommended_specialists_deduplicates():
    """Returns each specialist at most once."""
    text = "LowEnd.md mentioned again LowEnd.md"
    result = extract_recommended_specialists(text)
    assert result.count("LowEnd") == 1


def test_extract_recommended_specialists_empty():
    """Returns empty list when no specialists mentioned."""
    result = extract_recommended_specialists("no specialists here")
    assert result == []


def test_valid_specialists_does_not_include_triage():
    """Triage should not be a valid specialist (it's the router)."""
    assert "Triage" not in VALID_SPECIALISTS


@pytest.mark.asyncio
async def test_run_triage_calls_claude_and_parses_specialists(tmp_path, monkeypatch):
    """run_triage calls the Anthropic client and returns structured output."""
    fake_prompts = tmp_path / "experts"
    fake_prompts.mkdir()
    (fake_prompts / "Triage.md").write_text("You are the triage router.")
    monkeypatch.setattr("app.services.expert_service.PROMPTS_DIR", fake_prompts)

    fake_message = MagicMock()
    fake_message.content = [MagicMock(text="1. LowEnd.md [PRIORITY: CRITICAL]\n2. Dynamics.md")]

    mock_create = AsyncMock(return_value=fake_message)

    with patch("app.services.expert_service.AsyncAnthropic") as MockClient:
        instance = MockClient.return_value
        instance.messages.create = mock_create

        from app.services.expert_service import run_triage

        result = await run_triage({"audio_analysis": {"bpm": 138}})

    assert result["text"] == "1. LowEnd.md [PRIORITY: CRITICAL]\n2. Dynamics.md"
    assert "LowEnd" in result["recommended_specialists"]
    assert "Dynamics" in result["recommended_specialists"]


@pytest.mark.asyncio
async def test_stream_specialist_yields_chunks(tmp_path, monkeypatch):
    """stream_specialist yields chunk events then a done event."""
    fake_prompts = tmp_path / "experts"
    fake_prompts.mkdir()
    (fake_prompts / "LowEnd.md").write_text("You are the low end specialist.")
    monkeypatch.setattr("app.services.expert_service.PROMPTS_DIR", fake_prompts)

    async def fake_text_stream():
        yield "Hello "
        yield "world"

    mock_stream_ctx = MagicMock()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_ctx)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=False)
    mock_stream_ctx.text_stream = fake_text_stream()

    with patch("app.services.expert_service.AsyncAnthropic") as MockClient:
        instance = MockClient.return_value
        instance.messages.stream = MagicMock(return_value=mock_stream_ctx)

        from app.services.expert_service import stream_specialist

        events = []
        async for event in stream_specialist("LowEnd", {"bpm": 138}):
            events.append(event)

    assert events[0]["event"] == "chunk"
    assert json.loads(events[0]["data"])["text"] == "Hello "
    assert events[1]["event"] == "chunk"
    assert json.loads(events[1]["data"])["text"] == "world"
    assert events[-1]["event"] == "done"
