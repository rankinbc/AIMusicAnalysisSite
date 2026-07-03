"""Story 4.6 — delete_account_data: full content cascade, billing retained,
objects deleted, idempotent."""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from aimusic_shared.models import (  # noqa: E402
    Analysis,
    AnalysisJob,
    Base,
    CoachMessage,
    Conversation,
    ReferenceTrack,
    Song,
    SongVersion,
    User,
    Verdict,
)
from app import account_deletion_actor as ada  # noqa: E402

NOW = datetime(2026, 7, 3, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture()
def db(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        # Billing tables (EF-only) + the two per-user annotation tables that
        # have no python mirror.
        conn.execute(text("CREATE TABLE credit_ledger (user_id CHAR(32), amount INTEGER)"))
        conn.execute(text("CREATE TABLE version_user_ratings (user_id CHAR(32), version_id CHAR(32), score INTEGER)"))
        conn.execute(text("CREATE TABLE version_compare_notes (user_id CHAR(32), id CHAR(32))"))
    factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    monkeypatch.setattr(ada, "SessionFactory", factory)
    monkeypatch.setattr(ada, "LOCAL_ROOT", str(tmp_path))
    monkeypatch.delenv("S3_ENDPOINT", raising=False)
    return factory, tmp_path


def test_purge_deletes_content_keeps_billing_and_is_idempotent(db):
    factory, tmp_path = db
    uid = uuid.uuid4()
    other = uuid.uuid4()
    sid, vid, jid, aid, cid, rid = (uuid.uuid4() for _ in range(6))

    key = f"audio/{uid}/{jid}/source.wav"
    stem_key = f"stems/{jid}/kick.wav"
    spec_key = f"analysis/images/{jid}/spectrogram.webp"
    ref_key = f"reference/{rid}/source.wav"
    files = []
    for k in (key, stem_key, spec_key, ref_key):
        p = tmp_path / k
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
        files.append(p)

    with factory.begin() as s:
        s.add(User(id=uid, email=f"{uid}@t.test", hashed_password="x"))
        s.add(User(id=other, email=f"{other}@t.test", hashed_password="x"))
        s.add(Song(id=sid, user_id=uid, name="Mine"))
        s.add(SongVersion(id=vid, song_id=sid, version_number=1, file_path=key,
                          stem_paths={"kick": [stem_key]}))
        s.add(AnalysisJob(id=jid, user_id=uid, version_id=vid, status="complete"))
        s.add(Analysis(id=aid, job_id=jid, user_id=uid, version_id=vid, song_id=sid,
                       final_json={}, spectrogram_image_path=spec_key, created_at=NOW))
        s.add(Verdict(id="vrd_gdpr_test_0000000000001", analysis_id=aid,
                      specialist="mix_down", prompt_version="v1", model="t",
                      severity="moderate", category="low_end", confidence=0.5,
                      priority_score=10, impact="med", headline="h", created_at=NOW))
        s.add(Conversation(id=cid, analysis_id=aid, user_id=uid, created_at=NOW))
        s.add(CoachMessage(id=uuid.uuid4(), conversation_id=cid, role="user",
                           content="private words", created_at=NOW))
        s.add(ReferenceTrack(id=rid, user_id=uid, title="Ref", file_path=ref_key))
        # Another user's data must be untouched.
        other_sid = uuid.uuid4()
        s.add(Song(id=other_sid, user_id=other, name="Theirs"))
        # Billing rows RETAINED by policy.
        s.execute(text("INSERT INTO credit_ledger VALUES (:u, 5)"), {"u": uid.hex})
        s.execute(text("INSERT INTO version_user_ratings VALUES (:u, :v, 80)"),
                  {"u": uid.hex, "v": vid.hex})

    stats = ada.purge_account_data(str(uid))
    assert stats["rows_deleted"] >= 8
    assert stats["objects_failed"] == 0
    assert all(not f.exists() for f in files)  # audio + stems + image + reference gone

    with factory() as s:
        assert s.execute(text("SELECT count(*) FROM songs WHERE user_id = :u"), {"u": uid.hex}).scalar() == 0
        assert s.execute(text("SELECT count(*) FROM song_versions")).scalar() == 0
        assert s.execute(text("SELECT count(*) FROM analyses")).scalar() == 0
        assert s.execute(text("SELECT count(*) FROM analysis_jobs")).scalar() == 0
        assert s.execute(text("SELECT count(*) FROM verdicts")).scalar() == 0
        assert s.execute(text("SELECT count(*) FROM conversations")).scalar() == 0
        assert s.execute(text("SELECT count(*) FROM coach_messages")).scalar() == 0
        assert s.execute(text("SELECT count(*) FROM reference_tracks")).scalar() == 0
        assert s.execute(text("SELECT count(*) FROM version_user_ratings")).scalar() == 0
        # Retained by policy (pseudonymous financial records).
        assert s.execute(text("SELECT count(*) FROM credit_ledger WHERE user_id = :u"), {"u": uid.hex}).scalar() == 1
        # Other user's content untouched.
        assert s.execute(text("SELECT count(*) FROM songs WHERE user_id = :u"), {"u": other.hex}).scalar() == 1

    # Idempotent: replay deletes nothing, raises nothing.
    replay = ada.purge_account_data(str(uid))
    assert replay["rows_deleted"] == 0
