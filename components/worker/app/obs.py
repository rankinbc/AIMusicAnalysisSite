"""Story 10.3 — worker observability: correlation ids + Sentry + metrics.

Correlation convention (NFR30): the ANALYSIS/JOB id is the one id traceable
upload -> job -> actors -> llm_calls -> report render. Actors call
``set_correlation(...)`` first thing; the logging Filter stamps it on every
record and Sentry inherits it as a tag.

Everything here is optional-by-config: without SENTRY_DSN Sentry no-ops;
prometheus counters always count (the exporter only binds when the dramatiq
Prometheus middleware is enabled in dramatiq_app).
"""
from __future__ import annotations

import contextvars
import logging
import os

from prometheus_client import Counter, Histogram

_correlation: contextvars.ContextVar[str] = contextvars.ContextVar(
    "spectr_correlation_id", default="-")

# ── metrics (AC2 custom counters) ────────────────────────────────────────────
JOB_DURATION = Histogram(
    "spectr_job_duration_seconds",
    "Analysis job wall-clock duration by tier and terminal status.",
    ["tier", "status"],
    buckets=(5, 15, 30, 60, 120, 180, 300, 600, 1200),
)
LLM_COST = Counter(
    "spectr_llm_cost_usd_total",
    "Cumulative LLM spend in USD by tier and purpose.",
    ["tier", "purpose"],
)
VALIDATION_REJECTS = Counter(
    "spectr_verdict_validation_rejects_total",
    "Verdicts rejected by the validator (previously log-only).",
    ["slug"],
)


def set_correlation(correlation_id: object) -> None:
    """Bind the correlation id to this actor invocation's context."""
    cid = str(correlation_id)
    _correlation.set(cid)
    _sentry_tag("correlation_id", cid)


def set_tag(name: str, value: object) -> None:
    """Extra Sentry tag (e.g. job_id on the verdict lanes, analysis_id on
    coach) so the upload→job→actors→LLM chain is searchable by EITHER id —
    the analyze lane correlates by job id, the verdict lanes by analysis id."""
    _sentry_tag(name, str(value))


def _sentry_tag(name: str, value: str) -> None:
    try:
        import sentry_sdk

        sentry_sdk.set_tag(name, value)
    except Exception:  # pragma: no cover - sentry absent/uninitialized
        pass


def make_correlation_reset_middleware():
    """Dramatiq middleware: reset the contextvar per message so actors that
    DON'T call set_correlation (classify_stems, sweeps, future actors) never
    log under the PREVIOUS message's id — a wrong correlation id is worse
    than none (review High). Factory keeps the dramatiq import out of
    module scope (obs is imported by DB-free unit tests)."""
    import dramatiq

    class CorrelationResetMiddleware(dramatiq.Middleware):
        def before_process_message(self, broker, message):  # noqa: ANN001
            _correlation.set("-")

    return CorrelationResetMiddleware()


def get_correlation() -> str:
    return _correlation.get()


class CorrelationFilter(logging.Filter):
    """Stamps %(correlation_id)s onto every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.correlation_id = _correlation.get()
        return True


def configure_logging() -> None:
    """Structured-ish console logging with the correlation id inline."""
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)s [%(correlation_id)s] %(name)s: %(message)s"))
    handler.addFilter(CorrelationFilter())
    root.handlers[:] = [handler]


def init_sentry() -> bool:
    """DSN-gated Sentry init (returns True when active)."""
    dsn = os.environ.get("SENTRY_DSN", "")
    if not dsn:
        return False
    import sentry_sdk
    from sentry_sdk.integrations.dramatiq import DramatiqIntegration

    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("SENTRY_ENVIRONMENT", "production"),
        integrations=[DramatiqIntegration()],
        traces_sample_rate=0.0,  # errors only — tracing is out of 10.3 scope
    )
    return True
