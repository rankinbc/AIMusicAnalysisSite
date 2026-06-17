"""Story 2.6 / AR35 — worker feature_flags reader: 60s cache + hot-reload + fail-open.

No DB needed: ``_load`` and the monotonic clock (``_now``) are monkeypatched so the
TTL behaviour is deterministic. Proves the worker picks up an operator's cap change
within the 60 s window (the worker half of AC3), mirroring the BFF's cached read.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app import feature_flags as ff


@pytest.fixture(autouse=True)
def _isolate_cache():
    ff.reset_cache()
    saved_now = ff._now
    yield
    ff.reset_cache()
    ff._now = saved_now


def _fixed_clock(value):
    return lambda: value


def test_loads_and_caches_within_ttl(monkeypatch):
    calls = {"n": 0}

    def _load():
        calls["n"] += 1
        return {"coach_pro_monthly": "300"}

    monkeypatch.setattr(ff, "_load", _load)
    monkeypatch.setattr(ff, "_now", _fixed_clock(1000.0))

    assert ff.get_flags() == {"coach_pro_monthly": "300"}
    # Second read within the TTL window must NOT hit the DB again.
    assert ff.get_flags() == {"coach_pro_monthly": "300"}
    assert calls["n"] == 1


def test_reloads_after_ttl_expires(monkeypatch):
    values = [{"coach_pro_monthly": "300"}, {"coach_pro_monthly": "500"}]
    calls = {"n": 0}

    def _load():
        v = values[min(calls["n"], len(values) - 1)]
        calls["n"] += 1
        return v

    monkeypatch.setattr(ff, "_load", _load)

    monkeypatch.setattr(ff, "_now", _fixed_clock(1000.0))
    assert ff.get_flag_int("coach_pro_monthly", 0) == 300

    # Still inside the 60 s window → stale value, no reload.
    monkeypatch.setattr(ff, "_now", _fixed_clock(1059.0))
    assert ff.get_flag_int("coach_pro_monthly", 0) == 300
    assert calls["n"] == 1

    # Past the TTL → operator's new value is picked up.
    monkeypatch.setattr(ff, "_now", _fixed_clock(1061.0))
    assert ff.get_flag_int("coach_pro_monthly", 0) == 500
    assert calls["n"] == 2


def test_fail_open_returns_defaults(monkeypatch):
    def _boom():
        raise RuntimeError("DB down")

    monkeypatch.setattr(ff, "_load", _boom)
    monkeypatch.setattr(ff, "_now", _fixed_clock(2000.0))

    # Cold-start failure → empty snapshot → callers get their defaults.
    assert ff.get_flags() == {}
    assert ff.get_flag_decimal("llm_budget_pro_usd", Decimal("100.00")) == Decimal("100.00")
    assert ff.get_flag_int("coach_pro_monthly", 42) == 42


def test_decimal_and_int_parse_failures_fall_back(monkeypatch):
    monkeypatch.setattr(ff, "_load", lambda: {"bad_dec": "not-a-number", "bad_int": "3.5"})
    monkeypatch.setattr(ff, "_now", _fixed_clock(3000.0))

    assert ff.get_flag_decimal("bad_dec", Decimal("9.99")) == Decimal("9.99")
    assert ff.get_flag_int("bad_int", 7) == 7


def test_zero_ceiling_is_honored_not_treated_as_missing(monkeypatch):
    # An operator setting a ceiling of 0 must return Decimal('0'), NOT the default
    # — callers None-check, so 0 is a valid hard-stop value.
    monkeypatch.setattr(ff, "_load", lambda: {"llm_budget_pro_usd": "0"})
    monkeypatch.setattr(ff, "_now", _fixed_clock(4000.0))

    assert ff.get_flag_decimal("llm_budget_pro_usd", Decimal("100.00")) == Decimal("0")
