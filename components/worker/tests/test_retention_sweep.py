"""Story 3.4 — retention sweep: tier windows, NFR20 survivors, idempotence,
fail-closed billing guard, anon no-op guard."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from aimusic_shared.models import (  # noqa: E402
    Analysis,
    Base,
    CoachMessage,
    Conversation,
    Song,
    SongVersion,
    User,
    Verdict,
)
from app import retention_actor as ra  # noqa: E402

NOW = datetime(2026, 7, 3, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture()
def db(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE subscriptions (user_id CHAR(32) PRIMARY KEY, status TEXT, current_period_end TIMESTAMP)"
        ))
        conn.execute(text("CREATE TABLE credit_ledger (user_id CHAR(32), amount INTEGER)"))
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    monkeypatch.setattr(ra, "SessionFactory", factory)
    monkeypatch.setattr(ra, "LOCAL_ROOT", str(tmp_path))
    # No S3 in unit tests — local deletes only.
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    return factory, tmp_path


def _seed_user_version(
    factory,
    tmp_path: Path,
    *,
    created_at: datetime,
    with_attachments: bool = False,
) -> tuple[uuid.UUID, uuid.UUID, list[Path]]:
    uid, sid, vid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    key = f"audio/{uid}/{uuid.uuid4()}/source.wav"
    files: list[Path] = []

    def _mk(k: str) -> None:
        p = tmp_path / k
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"RIFF....WAVE")
        files.append(p)

    _mk(key)
    ref_key = als_key = None
    stem_paths = None
    if with_attachments:
        ref_key = f"reference/{uuid.uuid4()}/source.wav"
        als_key = f"als/{uuid.uuid4()}/project.als"
        stem_key = f"stems/{uuid.uuid4()}/s1.wav"
        for k in (ref_key, als_key, stem_key):
            _mk(k)
        stem_paths = {"kick": [stem_key]}

    with factory.begin() as s:
        s.add(User(id=uid, email=f"{uid}@t.test", hashed_password="x"))
        s.add(Song(id=sid, user_id=uid, name=f"T{uid.hex[:6]}"))
        s.add(SongVersion(
            id=vid, song_id=sid, version_number=1, file_path=key,
            reference_path=ref_key, als_file_path=als_key,
            stem_paths=stem_paths, created_at=created_at,
        ))
    return uid, vid, files


def _purged_at(factory, vid: uuid.UUID):
    with factory() as s:
        return s.get(SongVersion, vid).raw_audio_purged_at


def test_free_tier_purges_after_window_and_keeps_recent(db):
    factory, tmp_path = db
    _, old_vid, old_files = _seed_user_version(
        factory, tmp_path, created_at=NOW - timedelta(days=31), with_attachments=True)
    _, new_vid, new_files = _seed_user_version(
        factory, tmp_path, created_at=NOW - timedelta(days=29))

    stats = ra.run_sweep(now=NOW)

    assert stats["purged_versions"] == 1
    assert all(not f.exists() for f in old_files)  # mix + ref + als + stem gone
    assert all(f.exists() for f in new_files)
    assert _purged_at(factory, old_vid) is not None
    assert _purged_at(factory, new_vid) is None


def test_paid_users_never_purged(db):
    factory, tmp_path = db
    sub_uid, sub_vid, sub_files = _seed_user_version(
        factory, tmp_path, created_at=NOW - timedelta(days=400))
    cred_uid, cred_vid, cred_files = _seed_user_version(
        factory, tmp_path, created_at=NOW - timedelta(days=400))
    with factory.begin() as s:
        s.execute(text(
            "INSERT INTO subscriptions VALUES (:u, 'active', :pe)"),
            {"u": sub_uid.hex, "pe": NOW + timedelta(days=10)})
        s.execute(text(
            "INSERT INTO credit_ledger VALUES (:u, 3)"), {"u": cred_uid.hex})

    stats = ra.run_sweep(now=NOW)

    assert stats["purged_versions"] == 0
    assert all(f.exists() for f in sub_files + cred_files)
    assert _purged_at(factory, sub_vid) is None
    assert _purged_at(factory, cred_vid) is None


def test_lapsed_paid_purges_only_after_ninety_days_post_lapse(db):
    factory, tmp_path = db
    # Lapsed 91 days ago — ALL raw audio purges, even recent versions.
    gone_uid, gone_vid, gone_files = _seed_user_version(
        factory, tmp_path, created_at=NOW - timedelta(days=5))
    # Lapsed 89 days ago — still inside the grace window.
    kept_uid, kept_vid, kept_files = _seed_user_version(
        factory, tmp_path, created_at=NOW - timedelta(days=400))
    # Sentinel period_end (mirror wrote now+10y) — treated as PAID.
    sent_uid, sent_vid, sent_files = _seed_user_version(
        factory, tmp_path, created_at=NOW - timedelta(days=400))
    with factory.begin() as s:
        s.execute(text("INSERT INTO subscriptions VALUES (:u, 'canceled', :pe)"),
                  {"u": gone_uid.hex, "pe": NOW - timedelta(days=91)})
        s.execute(text("INSERT INTO subscriptions VALUES (:u, 'canceled', :pe)"),
                  {"u": kept_uid.hex, "pe": NOW - timedelta(days=89)})
        s.execute(text("INSERT INTO subscriptions VALUES (:u, 'unpaid', :pe)"),
                  {"u": sent_uid.hex, "pe": NOW + timedelta(days=3650)})

    stats = ra.run_sweep(now=NOW)

    assert stats["purged_versions"] == 1
    assert all(not f.exists() for f in gone_files)
    assert _purged_at(factory, gone_vid) is not None
    assert all(f.exists() for f in kept_files) and _purged_at(factory, kept_vid) is None
    assert all(f.exists() for f in sent_files) and _purged_at(factory, sent_vid) is None


def test_nfr20_reports_verdicts_chats_survive(db):
    factory, tmp_path = db
    uid, vid, files = _seed_user_version(
        factory, tmp_path, created_at=NOW - timedelta(days=100))
    aid, jid, cid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with factory.begin() as s:
        version = s.get(SongVersion, vid)
        s.add(Analysis(id=aid, job_id=jid, user_id=uid, version_id=vid,
                       song_id=version.song_id, final_json={"grade": "B"},
                       created_at=NOW))
        s.add(Verdict(id="vrd_retention_test_1", analysis_id=aid, specialist="mix_down",
                      prompt_version="v1", model="test", severity="moderate",
                      category="low_end", confidence=0.8, priority_score=50,
                      impact="med", headline="h", created_at=NOW))
        s.add(Conversation(id=cid, analysis_id=aid, user_id=uid, created_at=NOW))
        s.add(CoachMessage(id=uuid.uuid4(), conversation_id=cid, role="user",
                           content="hi", created_at=NOW))

    ra.run_sweep(now=NOW)

    assert all(not f.exists() for f in files)  # raw audio purged...
    with factory() as s:
        assert s.get(Analysis, aid) is not None       # ...but the report,
        assert s.query(Verdict).count() == 1          # verdicts,
        assert s.get(Conversation, cid) is not None   # and chats all survive
        assert s.query(CoachMessage).count() == 1


def test_second_run_is_idempotent(db):
    factory, tmp_path = db
    _seed_user_version(factory, tmp_path, created_at=NOW - timedelta(days=31))
    first = ra.run_sweep(now=NOW)
    second = ra.run_sweep(now=NOW)
    assert first["purged_versions"] == 1
    assert second["purged_versions"] == 0  # marker filters it out (AC5)


def test_billing_failure_fails_closed(db, monkeypatch):
    factory, tmp_path = db
    _, vid, files = _seed_user_version(
        factory, tmp_path, created_at=NOW - timedelta(days=400))
    # Simulate schema drift: the subscriptions table vanishes.
    with factory.begin() as s:
        s.execute(text("DROP TABLE subscriptions"))

    stats = ra.run_sweep(now=NOW)

    assert stats["skipped"] is True
    assert stats["purged_versions"] == 0
    assert all(f.exists() for f in files)  # nothing purged when tier unknown
    assert _purged_at(factory, vid) is None


def test_anon_guard_noops_without_devices_table(db):
    factory, _ = db
    stats = ra.run_sweep(now=NOW)
    assert stats["anon_purged"] == 0  # AC3 — safe before Epic 4


def test_auth_tokens_purge_and_absent_table_tolerance(db):
    """Story 4.3: consumed + long-expired auth tokens are deleted; live ones
    survive; a DB without the table (sqlite mirrors) is a logged no-op."""
    factory, _ = db
    # Absent table → tolerated.
    assert ra.run_sweep(now=NOW)["auth_tokens_purged"] == 0

    with factory.begin() as s:
        s.execute(text(
            "CREATE TABLE auth_tokens (id CHAR(32) PRIMARY KEY, user_id CHAR(32), "
            "purpose TEXT, token_hash TEXT, expires_at TIMESTAMP, "
            "consumed_at TIMESTAMP, created_at TIMESTAMP)"
        ))
        s.execute(text(
            "INSERT INTO auth_tokens VALUES "
            "('a1','u1','verify_email','h1',:live,NULL,:now),"      # live — kept
            "('a2','u1','verify_email','h2',:old,NULL,:now),"       # expired > 7d — purged
            "('a3','u1','reset_password','h3',:live,:now,:now)"     # consumed — purged
        ), {
            "live": NOW + timedelta(hours=1),
            "old": NOW - timedelta(days=8),
            "now": NOW,
        })

    stats = ra.run_sweep(now=NOW)
    assert stats["auth_tokens_purged"] == 2
    with factory() as s:
        remaining = s.execute(text("SELECT id FROM auth_tokens")).scalars().all()
        assert remaining == ["a1"]


def test_unknown_subscription_status_is_protected(db):
    """Stripe statuses outside both lists (paused, incomplete, future ones)
    must fail SAFE — never fall through to the shorter free-tier rule."""
    factory, tmp_path = db
    uid, vid, files = _seed_user_version(
        factory, tmp_path, created_at=NOW - timedelta(days=400))
    with factory.begin() as s:
        s.execute(text("INSERT INTO subscriptions VALUES (:u, 'paused', :pe)"),
                  {"u": uid.hex, "pe": NOW - timedelta(days=200)})

    stats = ra.run_sweep(now=NOW)

    assert stats["purged_versions"] == 0
    assert all(f.exists() for f in files)
    assert _purged_at(factory, vid) is None


def test_all_deletes_failed_leaves_version_unmarked(db, monkeypatch):
    """A version whose EVERY delete failed must retry next night — marking it
    would hide the objects behind the idempotency filter forever."""
    factory, tmp_path = db
    _, vid, files = _seed_user_version(
        factory, tmp_path, created_at=NOW - timedelta(days=31))

    def _boom(_key, _root):
        raise RuntimeError("s3 down")

    monkeypatch.setattr(ra.object_store, "delete_object", _boom)
    stats = ra.run_sweep(now=NOW)

    assert stats["failed_versions"] == 1
    assert stats["purged_versions"] == 0
    assert _purged_at(factory, vid) is None  # retried on the next run


def test_absolute_stored_path_is_rejected_not_deleted(db, tmp_path):
    """A poisoned absolute file_path must never delete outside the root."""
    factory, root = db
    outside = tmp_path / "outside.wav"
    outside.write_bytes(b"RIFF....WAVE")
    uid, sid, vid = __import__("uuid").uuid4(), __import__("uuid").uuid4(), __import__("uuid").uuid4()
    with factory.begin() as s:
        s.add(User(id=uid, email=f"{uid}@t.test", hashed_password="x"))
        s.add(Song(id=sid, user_id=uid, name="T"))
        s.add(SongVersion(id=vid, song_id=sid, version_number=1,
                          file_path=str(outside), created_at=NOW - timedelta(days=100)))

    stats = ra.run_sweep(now=NOW)

    assert outside.exists()                    # file outside the root untouched
    assert stats["failed_versions"] == 1       # delete rejected -> unmarked
    assert _purged_at(factory, vid) is None


def test_paid_signal_at_purge_time_spares_the_user(db):
    """Credits bought AFTER classification (e.g. prompted by the warning
    email) spare the user within the same run."""
    factory, tmp_path = db
    uid, vid, files = _seed_user_version(
        factory, tmp_path, created_at=NOW - timedelta(days=31))
    # Classification snapshot sees no credits... but the re-check does.
    original = ra._classify_users

    def _classify_then_pay(session, now, lapsed_days):
        result = original(session, now, lapsed_days)
        with factory.begin() as s:
            s.execute(text("INSERT INTO credit_ledger VALUES (:u, 1)"), {"u": uid.hex})
        return result

    import unittest.mock as mock
    with mock.patch.object(ra, "_classify_users", _classify_then_pay):
        stats = ra.run_sweep(now=NOW)

    assert stats["purged_versions"] == 0
    assert all(f.exists() for f in files)
    assert _purged_at(factory, vid) is None
