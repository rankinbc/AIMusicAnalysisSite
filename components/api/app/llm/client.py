from __future__ import annotations
import asyncio
import subprocess
import tempfile
from abc import ABC, abstractmethod
from pathlib import Path


class LLMInvocationError(Exception):
    """LLM subprocess returned a non-zero exit code."""


class LLMTimeoutError(Exception):
    """LLM call exceeded the timeout."""


class LLMClient(ABC):
    @abstractmethod
    async def call(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 4096,
        timeout_s: int = 90,
    ) -> str:
        """Return raw text output from the model. Caller is responsible for parsing."""


class CliClient(LLMClient):
    """Wraps the `claude` CLI via subprocess.

    - System prompt is written to a tempfile and passed via --system-prompt-file.
    - User message is passed inline via -p.
    - asyncio.Semaphore(1) ensures the CLI is never called concurrently from a
      single API process — empirically the CLI is not concurrency-safe.
    """

    def __init__(self) -> None:
        self._sema = asyncio.Semaphore(1)

    async def call(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int = 4096,  # noqa: ARG002 — CLI doesn't expose; kept for ABC parity
        timeout_s: int = 90,
    ) -> str:
        async with self._sema:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".md", delete=False, encoding="utf-8"
            ) as f:
                f.write(system)
                system_path = Path(f.name)
            try:
                cmd = [
                    "claude", "-p", user,
                    "--system-prompt-file", str(system_path),
                    "--output-format", "text",
                ]
                try:
                    completed = await asyncio.to_thread(
                        subprocess.run,
                        cmd,
                        capture_output=True,
                        timeout=timeout_s,
                    )
                except subprocess.TimeoutExpired as e:
                    raise LLMTimeoutError(
                        f"claude CLI exceeded {timeout_s}s timeout"
                    ) from e
                if completed.returncode != 0:
                    stderr = completed.stderr.decode(errors="replace").strip()
                    raise LLMInvocationError(
                        f"claude CLI exited {completed.returncode}: {stderr}"
                    )
                return completed.stdout.decode(errors="replace")
            finally:
                system_path.unlink(missing_ok=True)


class ApiClient(LLMClient):
    """Stub for the Anthropic API path (deferred to follow-up PRP)."""

    async def call(self, **kwargs) -> str:  # noqa: ARG002
        raise NotImplementedError(
            "Anthropic API transport is deferred. Use CliClient with USE_CLAUDE_CLI=true."
        )
