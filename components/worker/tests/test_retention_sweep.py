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


def test_orphaned_account_content_requeues_purge(db, monkeypatch):
    """Story 4.6 self-heal: songs whose user row is gone (failed purge
    enqueue) re-enqueue delete_account_data from the nightly sweep."""
    from app import account_deletion_actor as ada

    factory, _ = db
    ghost = uuid.uuid4()
    with factory.begin() as s:
        s.add(Song(id=uuid.uuid4(), user_id=ghost, name="Orphan"))  # no users row

    sent: list[str] = []
    monkeypatch.setattr(ada.delete_account_data, "send", lambda uid: sent.append(uid))

    stats = ra.run_sweep(now=NOW)
    assert stats["orphaned_accounts_requeued"] == 1
    # sqlite yields undashed hex, PG dashed — the actor's uuid.UUID() parse
    # accepts both; compare canonically.
    assert [uuid.UUID(x) for x in sent] == [ghost]


def test_anon_guard_noops_without_devices_table(db):
    factory, _ = db
    stats = ra.run_sweep(now=NOW)
    assert stats["anon_purged"] == 0  # no stale devices — nothing to purge


def test_unclaimed_devices_purge_with_owned_rows(db):
    """Story 4.5 (AR26): unclaimed >72h devices purge WITH their jobs,
    reports, conversations, coach messages, and verdicts; claimed and fresh
    devices survive untouched."""
    from aimusic_shared.models import (
        Analysis, AnalysisJob, CoachMessage, Conversation, Device, Verdict,
    )

    factory, _ = db
    stale_dev, fresh_dev, claimed_dev = "D" * 26, "F" * 26, "C" * 26
    aid, cid, jid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with factory.begin() as s:
        s.add(Device(id=stale_dev, ip_hash="i", ua_hash="u",
                     created_at=NOW - timedelta(hours=73)))
        s.add(Device(id=fresh_dev, ip_hash="i", ua_hash="u",
                     created_at=NOW - timedelta(hours=1)))
        s.add(Device(id=claimed_dev, ip_hash="i", ua_hash="u",
                     created_at=NOW - timedelta(hours=100),
                     claimed_at=NOW - timedelta(hours=99)))
        s.add(AnalysisJob(id=jid, device_id=stale_dev, status="complete"))
        s.add(Analysis(id=aid, job_id=jid, device_id=stale_dev,
                       final_json={}, created_at=NOW))
        s.add(Verdict(id="vrd_anonpurge_test_000000001", analysis_id=aid,
                      specialist="mix_down", prompt_version="v1", model="t",
                      severity="moderate", category="low_end", confidence=0.5,
                      priority_score=10, impact="med", headline="h", created_at=NOW))
        s.add(Conversation(id=cid, analysis_id=aid, device_id=stale_dev, created_at=NOW))
        s.add(CoachMessage(id=uuid.uuid4(), conversation_id=cid, role="user",
                           content="hi", created_at=NOW))

    stats = ra.run_sweep(now=NOW)

    assert stats["anon_purged"] == 1
    with factory() as s:
        remaining = s.execute(text("SELECT id FROM devices")).scalars().all()
        assert sorted(remaining) == sorted([fresh_dev, claimed_dev])
        assert s.execute(text("SELECT count(*) FROM analysis_jobs WHERE device_id IS NOT NULL")).scalar() == 0
        assert s.execute(text("SELECT count(*) FROM analyses")).scalar() == 0
        assert s.execute(text("SELECT count(*) FROM conversations")).scalar() == 0
        assert s.execute(text("SELECT count(*) FROM coach_messages")).scalar() == 0
        assert s.execute(text("SELECT count(*) FROM verdicts")).scalar() == 0


def test_anon_purge_deletes_upload_objects(db, tmp_path, monkeypatch):
    """Story 6.3 (AC7 + review): the 72h anon purge deletes the source upload
    AND the derived artifacts (spectrogram/waveform images + durable report
    JSON) — the trust page's 'device data and its analyses purged' must be true
    for every FILE, not just rows. A delete spy captures the requested keys
    (storage-form-independent: the durable report key is reconstructed from the
    analyses.job_id, whose text form differs under the sqlite test mirror)."""
    from aimusic_shared.models import Analysis, AnalysisJob, Device

    factory, _ = db
    monkeypatch.setattr(ra, "LOCAL_ROOT", str(tmp_path))
    deleted: list[str] = []
    monkeypatch.setattr(ra.object_store, "delete_object",
                        lambda key, root: deleted.append(key) or True)

    dev = "A" * 26
    jid = uuid.uuid4()
    src = f"audio/anon/{dev}/{jid}/source.wav"
    spec = f"analysis/images/{jid}/spectrogram.webp"
    wave = f"analysis/images/{jid}/waveform.webp"

    with factory.begin() as s:
        s.add(Device(id=dev, ip_hash="i", ua_hash="u",
                     created_at=NOW - timedelta(hours=73)))
        s.add(AnalysisJob(id=jid, device_id=dev, status="complete", file_path=src))
        s.add(Analysis(id=uuid.uuid4(), job_id=jid, device_id=dev, final_json={},
                       spectrogram_image_path=spec, waveform_image_path=wave,
                       created_at=NOW))

    stats = ra.run_sweep(now=NOW)

    assert stats["anon_purged"] == 1
    # Source + both images requested by exact key; the durable report by prefix
    # (its job-id text form is DB-dependent, hyphenated in prod Postgres).
    assert src in deleted
    assert spec in deleted
    assert wave in deleted
    assert any(k.startswith("reports/") and k.endswith(".json") for k in deleted)
    with factory() as s:
        assert s.execute(text("SELECT count(*) FROM devices")).scalar() == 0


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


# ── Story 12.8: the shared demo blob is never any one user's data ────────────

def test_version_keys_excludes_shared_demo_key():
    from app.retention_actor import SHARED_STORAGE_KEYS, _version_keys

    class Row:
        file_path = "audio/demo/source.wav"
        reference_path = "audio/upload/x/ref.wav"
        als_file_path = None
        stem_paths = None
        stem_paths_raw = None

    keys = _version_keys(Row())
    assert "audio/demo/source.wav" not in keys
    assert keys == ["audio/upload/x/ref.wav"]
    assert "audio/demo/source.wav" in SHARED_STORAGE_KEYS
