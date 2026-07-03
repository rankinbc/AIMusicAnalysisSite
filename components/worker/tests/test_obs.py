"""Story 10.3 — obs module: correlation contextvar, log filter, metrics."""
from __future__ import annotations

import logging

from app import obs


def test_correlation_contextvar_roundtrip():
    # No default assertion — other suite tests may run actors that set the
    # contextvar on this thread first.
    obs.set_correlation("11111111-2222-3333-4444-555555555555")
    assert obs.get_correlation() == "11111111-2222-3333-4444-555555555555"


def test_log_filter_stamps_correlation_id():
    obs.set_correlation("job-abc")
    rec = logging.LogRecord("t", logging.INFO, __file__, 1, "hello", (), None)
    assert obs.CorrelationFilter().filter(rec) is True
    assert rec.correlation_id == "job-abc"


def test_metrics_increment_without_exporter():
    # Counters must work standalone — the exporter (dramatiq middleware) is
    # optional and absent in tests.
    before = obs.LLM_COST.labels(tier="pro", purpose="triage")._value.get()
    obs.LLM_COST.labels(tier="pro", purpose="triage").inc(0.0123)
    after = obs.LLM_COST.labels(tier="pro", purpose="triage")._value.get()
    assert abs(after - before - 0.0123) < 1e-9

    obs.VALIDATION_REJECTS.labels(slug="low_end").inc()
    obs.JOB_DURATION.labels(tier="free", status="complete").observe(12.5)


def test_init_sentry_noops_without_dsn(monkeypatch):
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    assert obs.init_sentry() is False
