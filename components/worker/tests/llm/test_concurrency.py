"""Concurrency limits (AR6): the global semaphore caps total in-flight calls;
the coach sub-semaphore caps coach-purpose calls independently."""
from __future__ import annotations

import asyncio

from app.llm import gateway

from .conftest import FakeMessage


class _ConcurrencyProbe:
    def __init__(self, delay: float = 0.05):
        self.delay = delay
        self.inflight = 0
        self.max_inflight = 0


def _install_slow_client(monkeypatch, probe: _ConcurrencyProbe):
    class _Messages:
        def __init__(self):
            self.calls = []

        async def create(self, **kw):
            self.calls.append(kw)
            probe.inflight += 1
            probe.max_inflight = max(probe.max_inflight, probe.inflight)
            try:
                await asyncio.sleep(probe.delay)
                return FakeMessage("ok")
            finally:
                probe.inflight -= 1

    class _Client:
        def __init__(self):
            self.messages = _Messages()

    monkeypatch.setattr(gateway, "_get_client", lambda: _Client())


def test_global_semaphore_caps_inflight(configure, metered, monkeypatch):
    configure(llm_max_concurrency=2, llm_coach_concurrency=2)
    probe = _ConcurrencyProbe()
    _install_slow_client(monkeypatch, probe)

    async def drive():
        await asyncio.gather(*[
            gateway.complete(system="s", user=f"u{i}", purpose="specialist")
            for i in range(6)
        ])

    asyncio.run(drive())
    assert probe.max_inflight <= 2
    assert len(metered) == 6


def test_coach_sub_limit_binds(configure, metered, monkeypatch):
    # Global allows 5, but coach sub-pool is 1 → coach calls run one at a time.
    configure(llm_max_concurrency=5, llm_coach_concurrency=1)
    probe = _ConcurrencyProbe()
    _install_slow_client(monkeypatch, probe)

    async def drive():
        await asyncio.gather(*[
            gateway.complete(system="s", user=f"u{i}", purpose="coach")
            for i in range(4)
        ])

    asyncio.run(drive())
    assert probe.max_inflight == 1
