from __future__ import annotations
import asyncio
import subprocess
from unittest.mock import patch, MagicMock
import pytest
from app.llm.client import CliClient, LLMTimeoutError, LLMInvocationError


@pytest.mark.asyncio
async def test_cli_client_returns_stdout():
    completed = MagicMock(returncode=0, stdout=b'{"specialist":"low_end","verdicts":[]}',
                          stderr=b'')
    with patch("subprocess.run", return_value=completed) as mock_run:
        client = CliClient()
        out = await client.call(system="sys", user="usr")
    assert out == '{"specialist":"low_end","verdicts":[]}'
    args = mock_run.call_args[0][0]
    assert args[0] == "claude"
    assert "--system-prompt-file" in args
    # user message must be piped via stdin, NOT passed as a positional arg
    # (Windows caps any single command-line arg at ~8191 chars).
    assert "usr" not in args
    assert mock_run.call_args.kwargs["input"] == b"usr"


@pytest.mark.asyncio
async def test_cli_client_nonzero_exit_raises():
    completed = MagicMock(returncode=1, stdout=b'', stderr=b'auth failed')
    with patch("subprocess.run", return_value=completed):
        client = CliClient()
        with pytest.raises(LLMInvocationError, match="auth failed"):
            await client.call(system="sys", user="usr")


@pytest.mark.asyncio
async def test_cli_client_timeout_raises():
    def slow(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="claude", timeout=0.1)
    with patch("subprocess.run", side_effect=slow):
        client = CliClient()
        with pytest.raises(LLMTimeoutError):
            await client.call(system="sys", user="usr", timeout_s=1)


@pytest.mark.asyncio
async def test_cli_client_serializes_concurrent_calls():
    """CliClient must hold a Semaphore(1) — concurrent calls run sequentially."""
    call_log: list[str] = []

    async def fake_to_thread(fn, *args, **kwargs):
        call_log.append("start")
        await asyncio.sleep(0.05)
        call_log.append("end")
        return MagicMock(returncode=0, stdout=b"ok", stderr=b"")

    with patch("asyncio.to_thread", side_effect=fake_to_thread):
        client = CliClient()
        await asyncio.gather(
            client.call(system="s", user="u"),
            client.call(system="s", user="u"),
        )
    assert call_log == ["start", "end", "start", "end"]
