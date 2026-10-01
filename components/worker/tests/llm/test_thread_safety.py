"""Interactive AI lane — the `coach ai` pool runs several dramatiq threads in
one process, each driving its own ``asyncio.run`` loop through the gateway.
These pin the two pieces of shared gateway state that had to become
thread-safe for that: the per-loop semaphore cache and the circuit breaker.
"""
from __future__ import annotations

import asyncio
import threading

from app.llm import budget, gateway


def _sems_in_thread(out: list, barrier: threading.Barrier) -> None:
    async def body() -> None:
        first = gateway._semaphores()
        # Park until every thread has built its own loop's semaphores, so a
        # shared (non-thread-local) cache would have been overwritten by now.
        await asyncio.to_thread(barrier.wait)
        second = gateway._semaphores()
        out.append((first, second))

    asyncio.run(body())


def test_semaphores_are_per_thread_and_stable_within_a_loop(configure):
    configure()
    gateway.reset_semaphore_cache()
    n = 4
    barrier = threading.Barrier(n)
    out: list = []
    threads = [threading.Thread(target=_sems_in_thread, args=(out, barrier)) for _ in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert len(out) == n
    # Same loop → the SAME semaphores, even after other threads rebuilt theirs.
    assert all(f[0] is s[0] and f[1] is s[1] for f, s in out)
    # Different threads/loops → never each other's semaphores.
    assert len({id(first[0]) for first, _ in out}) == n


def test_semaphore_cache_rebuilds_for_a_new_loop_on_the_same_thread(configure):
    configure()
    gateway.reset_semaphore_cache()

    async def grab():
        return gateway._semaphores()

    a = asyncio.run(grab())
    b = asyncio.run(grab())
    assert a[0] is not b[0]


def test_breaker_error_streak_survives_concurrent_threads(configure):
    configure(llm_circuit_breaker_threshold=10_000)
    budget.reset_breaker_state()
    n_threads, per_thread = 8, 500
    start = threading.Barrier(n_threads)

    def hammer() -> None:
        start.wait()
        for _ in range(per_thread):
            budget.record_outcome(outcome="error")

    threads = [threading.Thread(target=hammer) for _ in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert budget._breaker.consecutive_errors == n_threads * per_thread
    budget.record_outcome(outcome="ok")
    assert budget._breaker.consecutive_errors == 0
    assert not budget._breaker_open()
