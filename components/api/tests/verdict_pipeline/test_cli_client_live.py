from __future__ import annotations
import shutil
import pytest
from app.llm.client import CliClient

pytestmark = pytest.mark.live_llm


@pytest.fixture(autouse=True)
def skip_if_no_cli():
    if shutil.which("claude") is None:
        pytest.skip("claude CLI not on PATH")


@pytest.mark.asyncio
async def test_cli_round_trip():
    client = CliClient()
    out = await client.call(
        system="You are a JSON echo. Reply with: {\"ok\": true}",
        user="echo",
        timeout_s=60,
    )
    assert "ok" in out.lower()
