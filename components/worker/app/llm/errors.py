"""Gateway exception hierarchy + story-1.4 degradation reason constants.

Lives below ``gateway.py`` and ``budget.py`` in the dependency graph so
both modules can import these names without creating a cycle. No
``anthropic`` import here (AR39 lint).
"""
from __future__ import annotations


# Story 1.4: degradation reasons stamped on ``analyses.degradation_notice``
# and carried on :class:`LlmBudgetExceeded` instances. Plain string constants
# (JSON-friendly) — not an enum.
DEGRADATION_REASON_TIER_BUDGET = "tier_budget"
DEGRADATION_REASON_GLOBAL_BUDGET = "global_budget"
DEGRADATION_REASON_CIRCUIT_BREAKER = "circuit_breaker"


class LlmError(RuntimeError):
    """Base for all gateway errors.

    Story 1.5 code review E-M1: subclasses (notably
    :class:`LlmInvocationError` raised on retry exhaustion) may carry the
    ULID of the ``llm_calls`` row the gateway wrote so callers can link a
    user-visible error to the metering row that caused it. Default is
    ``None`` because not every path writes a metered row (e.g.
    :class:`LlmBudgetExceeded` is raised PRE-call, un-metered).
    """

    llm_call_id: str | None = None


class LlmTimeoutError(LlmError):
    """Call timed out — retryable."""


class LlmRateLimitError(LlmError):
    """Provider rate limit — retryable."""


class LlmServerError(LlmError):
    """Provider 5xx / connection error — retryable."""


class LlmInvocationError(LlmError):
    """Non-retryable provider error (4xx, auth, bad request) or retry
    exhaustion."""


class LlmBudgetExceeded(LlmError):
    """Pre-call budget guard tripped — per-tier ceiling, global cap, or the
    provider-outage circuit breaker (story 1.4 / AR8). Raised PRE-call so
    nothing is metered. The actor catching it persists a degradation notice
    plus rule-engine verdicts (FR16).

    The ``reason`` attribute is one of ``DEGRADATION_REASON_*`` so callers
    can shape the notice payload without re-parsing strings. ``detail``
    holds an operator-readable explanation suitable for the notice JSON
    (no secrets, no PII).
    """

    def __init__(self, reason: str, detail: str | None = None) -> None:
        # Make ``str(exc)`` distinguishable from a bare reason so callers
        # passing ``str(exc)`` to the notice writer don't get the reason
        # duplicated into the detail field.
        super().__init__(detail if detail else f"{reason}: <no detail>")
        self.reason = reason
        self.detail = detail
