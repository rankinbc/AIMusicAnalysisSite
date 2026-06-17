"""Story 2.5 (FR34) — structural starvation isolation between worker pools.

Proves the paid pool (W1) never even *sees* the free-analysis flood, so paid
queue latency is independent of free-queue depth BY CONSTRUCTION. The guarantee
is delivered by process separation (W1 ≠ W2), not by intra-worker queue order
(``dramatiq.Worker.queues`` is an unordered ``set[str]`` — Dev Notes #3).

Uses a real ``StubBroker`` + ``dramatiq.Worker`` (never mock to pass). The global
broker is saved/restored so this test does not leak its broker into the rest of
the suite, which relies on the lazily-created default broker.
"""
from __future__ import annotations

import dramatiq
import dramatiq.broker
import pytest
from dramatiq.brokers.stub import StubBroker


@pytest.fixture
def stub_broker():
    prev = dramatiq.broker.global_broker
    broker = StubBroker()
    broker.emit_after("process_boot")
    dramatiq.set_broker(broker)
    try:
        yield broker
    finally:
        # Restore whatever (possibly None) was the global broker before us.
        dramatiq.broker.global_broker = prev


def _register_probes(broker):
    """Register one counter-actor per analysis queue so BOTH queues are declared
    (a Dramatiq consumer only attaches to a DECLARED queue — Dev Notes #2)."""
    counts = {"paid": 0, "free": 0}

    @dramatiq.actor(broker=broker, queue_name="analysis-paid", actor_name="_paid_probe")
    def paid_probe():
        counts["paid"] += 1

    @dramatiq.actor(broker=broker, queue_name="analysis-free", actor_name="_free_probe")
    def free_probe():
        counts["free"] += 1

    # Declaring before worker.start() avoids a race where the consumer is not
    # yet attached when the first message lands. (The decorators above already
    # declare these queues; this is belt-and-suspenders per Task 7.2.)
    broker.declare_queue("analysis-paid")
    broker.declare_queue("analysis-free")
    return paid_probe, free_probe, counts


def test_paid_pool_never_sees_free_flood(stub_broker):
    """W1 (coach, analysis-paid): a 100-deep free flood + 1 paid job → W1 runs
    the paid job and never touches the free queue. Paid latency is independent
    of free depth by construction."""
    paid_probe, free_probe, counts = _register_probes(stub_broker)

    for _ in range(100):
        free_probe.send()
    paid_probe.send()

    worker = dramatiq.Worker(stub_broker, queues={"coach", "analysis-paid"})
    worker.start()
    try:
        stub_broker.join("analysis-paid")
        worker.join()
    finally:
        worker.stop()

    assert counts["paid"] == 1, "W1 must process the single paid job"
    assert counts["free"] == 0, "W1 must NEVER consume the free flood"


def test_free_pool_drains_free_not_paid(stub_broker):
    """Symmetric W2 (analysis-free, maintenance): drains the free flood and never
    processes the paid queue."""
    paid_probe, free_probe, counts = _register_probes(stub_broker)

    for _ in range(100):
        free_probe.send()
    paid_probe.send()

    worker = dramatiq.Worker(stub_broker, queues={"analysis-free", "maintenance"})
    worker.start()
    try:
        stub_broker.join("analysis-free")
        worker.join()
    finally:
        worker.stop()

    assert counts["free"] == 100, "W2 must drain the entire free flood"
    assert counts["paid"] == 0, "W2 must NEVER consume the paid queue"
