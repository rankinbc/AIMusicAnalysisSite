"""D2 fix round 1: `app.llm.lane._lookup_is_guest` is stubbed by the autouse
fixture in `tests/llm/conftest.py` for every other LLM test — a real typo in
its table/column name would never be caught there, and it fails open by
design (a lookup error silently keeps the caller's default tier). This file
lives OUTSIDE tests/llm/ specifically so that autouse stub does not apply,
and exercises the real SQL against a seeded session (same sqlite fixture
pattern as tests/test_account_deletion.py)."""
from __future__ import annotations

import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from aimusic_shared.models import Base, User  # noqa: E402
from app import db_sync  # noqa: E402
from app.llm import lane  # noqa: E402


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    monkeypatch.setattr(db_sync, "SessionFactory", factory)
    return factory


def _mk_user(factory, *, is_guest: bool) -> uuid.UUID:
    uid = uuid.uuid4()
    with factory.begin() as s:
        s.add(User(id=uid, email=f"{uid}@t.test", hashed_password="x", is_guest=is_guest))
    return uid


def test_lookup_is_guest_runs_the_real_query_against_a_seeded_session(db):
    """The real function (not the conftest.py stub), against a real sqlite
    session with seeded rows: is_guest=true -> True, is_guest=false -> False,
    and an id with no matching row -> False (fail-open at the resolve_lane
    layer covers lookup ERRORS; this covers a plain miss)."""
    guest_id = _mk_user(db, is_guest=True)
    real_id = _mk_user(db, is_guest=False)
    unknown_id = uuid.uuid4()

    assert lane._lookup_is_guest(guest_id) is True
    assert lane._lookup_is_guest(real_id) is False
    assert lane._lookup_is_guest(unknown_id) is False
