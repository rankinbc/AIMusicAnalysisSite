"""Story 12.6 (review H2): the user-row stamp — the write side of the
refused/errored-turn cap refund. Tested directly against a stub session so
the linchpin ("the worker actually stamps") is proven in the suite, not just
assumed by the BFF read-side tests that hand-stamp rows.
"""
import uuid

from app.coach_actor import _stamp_user_row_refused


class _Row:
    def __init__(self, role: str, refusal_reason=None):
        self.role = role
        self.refusal_reason = refusal_reason


class _StubSession:
    def __init__(self, row):
        self._row = row

    def get(self, _model, _key):
        return self._row


def test_stamps_unstamped_user_row():
    row = _Row("user")
    _stamp_user_row_refused(_StubSession(row), uuid.uuid4(), "missing_data")
    assert row.refusal_reason == "missing_data"


def test_null_reason_falls_back_to_generic_marker():
    row = _Row("user")
    _stamp_user_row_refused(_StubSession(row), uuid.uuid4(), None)
    assert row.refusal_reason == "refused"  # cap exclusion keys on non-null


def test_idempotent_never_overwrites():
    row = _Row("user", refusal_reason="missing_data")
    _stamp_user_row_refused(_StubSession(row), uuid.uuid4(), "coach_error")
    assert row.refusal_reason == "missing_data"


def test_never_stamps_assistant_rows_or_missing_ids():
    arow = _Row("assistant")
    _stamp_user_row_refused(_StubSession(arow), uuid.uuid4(), "missing_data")
    assert arow.refusal_reason is None
    # None id: no-op, no raise.
    _stamp_user_row_refused(_StubSession(_Row("user")), None, "missing_data")


def test_stamp_failure_never_raises():
    class _BoomSession:
        def get(self, *_a):
            raise RuntimeError("db down")

    # Must swallow — a stamp failure may not roll back the terminalization tx.
    _stamp_user_row_refused(_BoomSession(), uuid.uuid4(), "missing_data")
