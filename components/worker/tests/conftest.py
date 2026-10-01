"""Worker test-suite root.

DATABASE_URL is FORCED (not defaulted) before any test module is imported:

* Speed — many code paths fail open on a DB error (feature flags, guest-lane
  lookup, budget aggregator...). Pointed at a TCP host with nothing
  listening, every one of those attempts costs 2-4 s on Windows (refused
  connects are retried), turning a sub-second test into ~100 s. A unix-socket
  path that doesn't exist fails in ~0 ms on every OS.
* Safety — test modules used ``os.environ.setdefault``, so a shell that had
  the real dev DATABASE_URL exported ran tests against the dev database.

Tests that need a real database build their own (sqlite via monkeypatch, see
tests/inspector) — nothing here may depend on a live Postgres.
"""
import os

os.environ["DATABASE_URL"] = "postgresql+psycopg2://test:test@/spectr_test?host=/nonexistent-spectr-test-socket"

# Same idea for Redis: actors bind to the GLOBAL broker when their module is
# imported, and without one dramatiq builds a real RedisBroker on
# localhost:6379. Every actor.send() inside the code under test (e.g.
# analyze_audio_job enqueuing structure detection) then dials Redis — instant
# refusal on CI, but a 30 s socket timeout per send when a dead WSL socket
# squats 6379 (docs/STARTUP.md #2). The in-memory StubBroker keeps sends
# local; tests that need their own broker still call dramatiq.set_broker().
# DRAMATIQ_BROKER=stub makes app.dramatiq_app (imported by test_actor_queues)
# build a StubBroker too, instead of swapping a RedisBroker in mid-session.
os.environ["DRAMATIQ_BROKER"] = "stub"
import dramatiq  # noqa: E402
from dramatiq.brokers.stub import StubBroker  # noqa: E402

dramatiq.set_broker(StubBroker())

from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles


@compiles(JSONB, "sqlite")
def _compile_jsonb_for_sqlite(element, compiler, **kw):
    """Render Postgres JSONB as SQLite JSON so Base.metadata.create_all
    works against in-memory sqlite test DBs."""
    return "JSON"
