"""Structural typing for the async LLM caller the pipeline stages expect.

The pipeline modules (triage, specialists, orchestrator) take an injected
client rather than constructing one, so they depend only on this Protocol —
never on a concrete client. The v1 api ``LLMClient`` satisfied it; test
doubles (``MockLLMClient``) satisfy it; the SDK gateway (story 1.3) will too.
"""
from __future__ import annotations

from typing import Protocol


class LLMCaller(Protocol):
    async def call(
        self, system: str, user: str, *, max_tokens: int = 4096, timeout_s: int = 90
    ) -> str: ...
