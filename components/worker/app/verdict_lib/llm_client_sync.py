"""Synchronous claude-CLI wrapper for use inside dramatiq actors.

The legacy ``components/api/app/llm/client.py`` is async (uses
``asyncio.to_thread`` and ``asyncio.Semaphore``). Dramatiq actors are sync,
and concurrency-safety is provided at the process level (one CLI call per
worker subprocess), so we don't need a semaphore here.

Run convention matches the legacy CliClient:

* System prompt is written to a tempfile and passed via ``--system-prompt-file``.
* User message is piped via stdin (``-p`` with no positional arg), required
  because Windows caps a single command-line arg at ~8191 chars and analysis
  JSON for a real track easily exceeds that.
"""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path


class LLMInvocationError(RuntimeError):
    """claude CLI returned a non-zero exit code."""


class LLMTimeoutError(RuntimeError):
    """claude CLI exceeded the configured timeout."""


def llm_call_sync(*, system: str, user: str, timeout_s: int = 90) -> str:
    """Invoke claude CLI synchronously. Returns raw stdout text.

    Raises ``LLMTimeoutError`` on subprocess timeout or ``LLMInvocationError``
    on non-zero exit. Caller is responsible for parsing the JSON out of the
    response (use ``json_extraction.extract_json_object``).
    """
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".md", delete=False, encoding="utf-8"
    ) as f:
        f.write(system)
        system_path = Path(f.name)

    try:
        cmd = [
            "claude",
            "-p",
            "--system-prompt-file", str(system_path),
            "--output-format", "text",
        ]
        try:
            completed = subprocess.run(
                cmd,
                input=user.encode("utf-8"),
                capture_output=True,
                timeout=timeout_s,
            )
        except subprocess.TimeoutExpired as e:
            raise LLMTimeoutError(f"claude CLI exceeded {timeout_s}s timeout") from e

        if completed.returncode != 0:
            stderr = completed.stderr.decode(errors="replace").strip()
            raise LLMInvocationError(
                f"claude CLI exited {completed.returncode}: {stderr}"
            )
        return completed.stdout.decode(errors="replace")
    finally:
        system_path.unlink(missing_ok=True)
