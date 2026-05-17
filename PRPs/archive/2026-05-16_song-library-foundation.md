# Song Library Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full song library feature minus the delta engine — explicit Song + SongVersion entities, full CRUD, save-to-library, analyze-version, soft-delete with restore, beat-task cleanup, and the frontend pages (Library, SongDetail) + modals (NewSong, AddVersion, SaveToLibrary) needed to drive them end to end.

**Architecture:** Three-layer chain `Song → SongVersion → UploadJob (analysis)`. `SongVersion` owns audio files on disk; `UploadJob` becomes a stateless analysis-run record with a nullable `version_id` FK. Existing quick-analyze flow at `POST /uploads/` stays — its files get a 30-day TTL via a new beat task. The frontend gets a new "library" state-machine branch in `App.jsx`; the existing embedded `SongLibrary.jsx` panel is removed.

**Tech Stack:** Python 3.11 / FastAPI / SQLAlchemy 2.0 async / Alembic / Celery / aimusic-shared ORM package / React 19 vanilla JSX (frontend-spectr).

**Spec reference:** `docs/superpowers/specs/2026-05-16-song-library-versioning-design.md` (sections 4, 5.1–5.3, 7, 8 — exclude §6 and §5.4, which belong to Plan B).

---

## File Structure

### Backend — files to create
- `components/api/alembic/versions/010_song_versioning.py`
- `components/api/app/schemas/songs.py` — **rewrite** existing file
- `components/api/app/schemas/versions.py` — new
- `components/api/app/routers/songs.py` — **rewrite** existing file (replaces today's CRUD)
- `components/api/app/routers/versions.py` — new
- `components/worker/app/tasks_cleanup.py` — extend existing file
- `components/api/tests/test_songs_router.py` — new
- `components/api/tests/test_versions_router.py` — new
- `components/api/tests/test_save_to_library.py` — new
- `components/api/tests/test_cleanup_tasks.py` — new
- `components/api/tests/test_migration_010.py` — new

### Backend — files to modify
- `components/shared/aimusic_shared/models.py` — add `SongVersion`, modify `Song` + `UploadJob`
- `components/api/app/routers/uploads.py` — drop `track_name`, drop auto-Song-upsert
- `components/api/app/routers/jobs.py` — add `POST /jobs/{job_id}/save-to-library`
- `components/api/app/routers/tracks.py` — delete file (legacy)
- `components/api/app/main.py` — drop `tracks` router, register `versions` router
- `components/worker/app/celery_app.py` — register two new beat-task schedules

### Frontend — files to create (`components/frontend-spectr/src/`)
- `api/versions.js` — new
- `components/NewSongModal.jsx` — new
- `components/AddVersionModal.jsx` — new
- `components/SaveToLibraryModal.jsx` — new
- `components/DeleteSongModal.jsx` — new
- `components/SongCard.jsx` — new
- `components/VersionRow.jsx` — new
- `components/LibraryPage.jsx` — new
- `components/SongDetailPage.jsx` — new

### Frontend — files to modify
- `api/songs.js` — extend client functions
- `api/client.js` — add `saveToLibrary` helper
- `App.jsx` — add `library` and `song-detail` states; wire up nav
- `components/UploadPage.jsx` — remove embedded `SongLibrary` panel
- `components/ResultsPage.jsx` — show "Save to Library" CTA + `SaveToLibraryModal`
- `components/SongLibrary.jsx` — **delete** (superseded by LibraryPage)

---

## Task 1: Update ORM models in aimusic-shared

**Files:**
- Modify: `components/shared/aimusic_shared/models.py`

- [ ] **Step 1: Replace the `Song` and `UploadJob` definitions and add `SongVersion`**

Open `components/shared/aimusic_shared/models.py`. Find the `class Song(Base)` block (currently lines 46–61). Replace it with:

```python
class Song(Base):
    """A user's library entry — owns 1+ SongVersion rows."""
    __tablename__ = "songs"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_songs_user_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    genre_hint: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    archived_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    versions: Mapped[list["SongVersion"]] = relationship("SongVersion", back_populates="song", lazy="noload", cascade="all, delete-orphan")


class SongVersion(Base):
    """An audio recording belonging to a Song — owns the audio file on disk."""
    __tablename__ = "song_versions"
    __table_args__ = (UniqueConstraint("song_id", "version_number", name="uq_song_versions_song_number"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    song_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("songs.id", ondelete="CASCADE"), nullable=False, index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    reference_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    als_file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    stem_paths_raw: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    stem_paths: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    song: Mapped[Song] = relationship("Song", back_populates="versions", lazy="noload")
    jobs: Mapped[list["UploadJob"]] = relationship("UploadJob", back_populates="version", lazy="noload")
```

Then find `class UploadJob(Base)` (currently around line 64). Replace the `track_name` line and `song_id` line with `version_id`, drop `song` relationship, add `version` relationship:

```python
class UploadJob(Base):
    __tablename__ = "upload_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[JobStatus] = mapped_column(SAEnum(JobStatus), default=JobStatus.PENDING, nullable=False)
    current_phase: Mapped[int] = mapped_column(Integer, default=0)
    phase_name: Mapped[str] = mapped_column(String(100), default="")
    phase_pct: Mapped[float] = mapped_column(Float, default=0.0)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    reference_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    als_file_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    genre_hint: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    task_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    version_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("song_versions.id", ondelete="CASCADE"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    stem_paths_raw: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    stem_paths: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    user: Mapped[User] = relationship("User", back_populates="jobs", lazy="noload")
    version: Mapped[Optional["SongVersion"]] = relationship("SongVersion", back_populates="jobs", lazy="noload")
    result: Mapped[Optional[AnalysisResult]] = relationship("AnalysisResult", back_populates="job", lazy="noload")
```

`track_name` and `song_id` columns are gone from the ORM. The actual DB columns are dropped in the migration (Task 2).

- [ ] **Step 2: Quick import sanity check**

Run: `python -c "from aimusic_shared.models import Song, SongVersion, UploadJob; print('ok')"`
Expected: `ok` (this only confirms Python imports — DB schema is verified in Task 3).

- [ ] **Step 3: Commit**

```bash
git add components/shared/aimusic_shared/models.py
git commit -m "feat(shared): add SongVersion model, replace UploadJob.song_id with version_id"
```

---

## Task 2: Write Alembic migration 010

**Files:**
- Create: `components/api/alembic/versions/010_song_versioning.py`

- [ ] **Step 1: Write the migration**

```python
"""Song versioning: SongVersion table, archived_at on songs, version_id on upload_jobs.

Drops legacy upload_jobs.song_id, upload_jobs.track_name,
and songs.{file_path, reference_path, als_file_path} after backfill.

Revision ID: 010
Revises: 009
Create Date: 2026-05-16
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. song_versions table
    op.create_table(
        "song_versions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("song_id", UUID(as_uuid=True), sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_number", sa.Integer, nullable=False),
        sa.Column("label", sa.String(120), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("file_path", sa.String(500), nullable=False),
        sa.Column("reference_path", sa.String(500), nullable=True),
        sa.Column("als_file_path", sa.String(500), nullable=True),
        sa.Column("stem_paths_raw", JSONB, nullable=True),
        sa.Column("stem_paths", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("song_id", "version_number", name="uq_song_versions_song_number"),
    )
    op.create_index("idx_song_versions_song_id", "song_versions", ["song_id"])
    op.create_index("idx_song_versions_song_created", "song_versions", ["song_id", "created_at"])

    # 2. songs.archived_at
    op.add_column("songs", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("idx_songs_archived_at", "songs", ["archived_at"])

    # 3. upload_jobs.version_id (nullable, no default — backfill below)
    op.add_column(
        "upload_jobs",
        sa.Column("version_id", UUID(as_uuid=True),
                  sa.ForeignKey("song_versions.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_index("idx_upload_jobs_version_id", "upload_jobs", ["version_id"])

    # 4. Backfill: one SongVersion per existing Song
    op.execute("""
        INSERT INTO song_versions (id, song_id, version_number, file_path, reference_path, als_file_path, created_at, updated_at)
        SELECT gen_random_uuid(), id, 1, file_path, reference_path, als_file_path, created_at, updated_at
        FROM songs
        WHERE file_path IS NOT NULL
    """)

    # 5. Backfill: link existing upload_jobs to their song's v1
    op.execute("""
        UPDATE upload_jobs
        SET version_id = sv.id
        FROM song_versions sv
        WHERE upload_jobs.song_id IS NOT NULL
          AND sv.song_id = upload_jobs.song_id
    """)

    # 6. Drop legacy columns
    op.drop_index("idx_upload_jobs_song_id", table_name="upload_jobs")
    op.drop_column("upload_jobs", "song_id")
    op.drop_column("upload_jobs", "track_name")
    op.drop_column("songs", "file_path")
    op.drop_column("songs", "reference_path")
    op.drop_column("songs", "als_file_path")


def downgrade() -> None:
    # Best-effort restore. Destructive — data loss for SongVersions with no Song mapping.
    op.add_column("songs", sa.Column("file_path", sa.String(500), nullable=True))
    op.add_column("songs", sa.Column("reference_path", sa.String(500), nullable=True))
    op.add_column("songs", sa.Column("als_file_path", sa.String(500), nullable=True))
    op.add_column("upload_jobs", sa.Column("track_name", sa.String(200), nullable=True))
    op.add_column(
        "upload_jobs",
        sa.Column("song_id", UUID(as_uuid=True),
                  sa.ForeignKey("songs.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_index("idx_upload_jobs_song_id", "upload_jobs", ["song_id"])

    # Pull first-version paths back onto songs
    op.execute("""
        UPDATE songs
        SET file_path      = sv.file_path,
            reference_path = sv.reference_path,
            als_file_path  = sv.als_file_path
        FROM song_versions sv
        WHERE sv.song_id = songs.id AND sv.version_number = 1
    """)
    op.execute("""
        UPDATE upload_jobs
        SET song_id = sv.song_id
        FROM song_versions sv
        WHERE upload_jobs.version_id = sv.id
    """)

    op.drop_index("idx_upload_jobs_version_id", table_name="upload_jobs")
    op.drop_column("upload_jobs", "version_id")

    op.drop_index("idx_songs_archived_at", table_name="songs")
    op.drop_column("songs", "archived_at")

    op.drop_index("idx_song_versions_song_created", table_name="song_versions")
    op.drop_index("idx_song_versions_song_id", table_name="song_versions")
    op.drop_table("song_versions")
```

- [ ] **Step 2: Apply the migration locally**

Run (from project root with docker services up):
```
alembic -c components/api/alembic.ini upgrade head
```
Expected: `INFO  [alembic.runtime.migration] Running upgrade 009 -> 010, Song versioning...`

- [ ] **Step 3: Verify the new schema**

Run (replace `aimusic` if your db name differs — check `.env`):
```
psql -U postgres -h localhost -d aimusic -c "\d song_versions"
psql -U postgres -h localhost -d aimusic -c "\d upload_jobs"
psql -U postgres -h localhost -d aimusic -c "\d songs"
```
Expected: `song_versions` exists with all columns; `upload_jobs` has `version_id` (no `song_id`/`track_name`); `songs` has `archived_at` (no `file_path`/`reference_path`/`als_file_path`).

- [ ] **Step 4: Roll forward & back to verify the down revision works**

```
alembic -c components/api/alembic.ini downgrade -1
alembic -c components/api/alembic.ini upgrade head
```
Expected: both succeed without errors.

- [ ] **Step 5: Commit**

```bash
git add components/api/alembic/versions/010_song_versioning.py
git commit -m "feat(db): migration 010 — SongVersion table, archived_at, version_id"
```

---

## Task 3: Migration data-integrity test

**Files:**
- Create: `components/api/tests/test_migration_010.py`

This test exercises the backfill against a real Postgres test DB (use the existing test DB pattern — check `components/api/tests/conftest.py` for any DB fixtures; if none exist, this test uses raw asyncpg).

- [ ] **Step 1: Write the test**

```python
"""Tests that migration 010 correctly backfills SongVersion + UploadJob.version_id."""
from __future__ import annotations

import os
import subprocess
import uuid

import asyncpg
import pytest

DB_URL = os.environ.get(
    "TEST_DB_URL_PSYCOPG",
    "postgresql://postgres:postgres@localhost:5432/aimusic_test",
)


async def _exec(sql: str, *args):
    conn = await asyncpg.connect(DB_URL)
    try:
        await conn.execute(sql, *args)
    finally:
        await conn.close()


async def _fetchrow(sql: str, *args):
    conn = await asyncpg.connect(DB_URL)
    try:
        return await conn.fetchrow(sql, *args)
    finally:
        await conn.close()


def _alembic(direction: str, target: str) -> None:
    env = os.environ.copy()
    env["ALEMBIC_DATABASE_URL"] = DB_URL
    subprocess.run(
        ["alembic", "-c", "components/api/alembic.ini", direction, target],
        check=True, env=env,
    )


@pytest.mark.skipif(
    not os.environ.get("RUN_MIGRATION_TESTS"),
    reason="Slow DB test; set RUN_MIGRATION_TESTS=1 to enable",
)
async def test_migration_010_backfills_song_versions(anyio_backend):
    # 1. Roll back to revision 009 (pre-versioning)
    _alembic("downgrade", "009")

    # 2. Seed: one user, one song with file_path, one upload_job linked to it
    user_id = uuid.uuid4()
    song_id = uuid.uuid4()
    job_id = uuid.uuid4()
    await _exec(
        "INSERT INTO users (id, email, hashed_password) VALUES ($1, $2, 'h')",
        user_id, f"mig{user_id}@example.com",
    )
    await _exec(
        "INSERT INTO songs (id, user_id, name, file_path, reference_path, als_file_path) "
        "VALUES ($1, $2, 'Track A', '/data/a.wav', '/data/aref.wav', NULL)",
        song_id, user_id,
    )
    await _exec(
        "INSERT INTO upload_jobs (id, user_id, status, file_path, song_id, track_name) "
        "VALUES ($1, $2, 'COMPLETE', '/data/a.wav', $3, 'Track A')",
        job_id, user_id, song_id,
    )

    # 3. Apply 010
    _alembic("upgrade", "head")

    # 4. Verify: one SongVersion(version_number=1) per Song, with paths copied
    row = await _fetchrow(
        "SELECT id, song_id, version_number, file_path, reference_path FROM song_versions WHERE song_id = $1",
        song_id,
    )
    assert row is not None
    assert row["version_number"] == 1
    assert row["file_path"] == "/data/a.wav"
    assert row["reference_path"] == "/data/aref.wav"

    # 5. Verify: upload_job.version_id points at the new version
    job_row = await _fetchrow(
        "SELECT version_id FROM upload_jobs WHERE id = $1", job_id,
    )
    assert job_row["version_id"] == row["id"]

    # 6. Verify: dropped columns are gone
    cols = await _fetchrow(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'upload_jobs' AND column_name = 'song_id'",
    )
    assert cols is None

    # 7. Cleanup
    await _exec("DELETE FROM upload_jobs WHERE id = $1", job_id)
    await _exec("DELETE FROM song_versions WHERE song_id = $1", song_id)
    await _exec("DELETE FROM songs WHERE id = $1", song_id)
    await _exec("DELETE FROM users WHERE id = $1", user_id)
```

- [ ] **Step 2: Run the test (with the env var set)**

Run: `RUN_MIGRATION_TESTS=1 pytest -q components/api/tests/test_migration_010.py -v`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/api/tests/test_migration_010.py
git commit -m "test(db): migration 010 backfill integrity"
```

---

## Task 4: Schemas for songs and versions

**Files:**
- Modify: `components/api/app/schemas/songs.py` (rewrite)
- Create: `components/api/app/schemas/versions.py`

- [ ] **Step 1: Replace `components/api/app/schemas/songs.py` with the new shape**

```python
"""Pydantic schemas for /songs/ endpoints."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class SongCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    genre_hint: Optional[str] = None


class SongPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    genre_hint: Optional[str] = None


class AnalysisSummary(BaseModel):
    job_id: str
    score: Optional[float] = None
    grade: Optional[str] = None
    created_at: str
    status: str


class VersionInSongDetail(BaseModel):
    version_id: str
    version_number: int
    label: Optional[str] = None
    notes: Optional[str] = None
    created_at: str
    latest_job_id: Optional[str] = None
    latest_score: Optional[float] = None
    latest_grade: Optional[str] = None
    analysis_count: int = 0


class SongSummary(BaseModel):
    song_id: str
    name: str
    genre_hint: Optional[str] = None
    version_count: int = 0
    latest_version_id: Optional[str] = None
    latest_job_id: Optional[str] = None
    latest_score: Optional[float] = None
    latest_grade: Optional[str] = None
    last_analyzed: Optional[str] = None
    created_at: str


class SongDetail(SongSummary):
    versions: list[VersionInSongDetail] = []
    archived_at: Optional[str] = None
```

- [ ] **Step 2: Create `components/api/app/schemas/versions.py`**

```python
"""Pydantic schemas for /versions/ endpoints."""
from typing import Optional

from pydantic import BaseModel, Field


class VersionPatch(BaseModel):
    version_number: Optional[int] = Field(default=None, ge=1)
    label: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = None


class AnalysisInVersionDetail(BaseModel):
    job_id: str
    status: str
    score: Optional[float] = None
    grade: Optional[str] = None
    created_at: str
    completed_at: Optional[str] = None


class VersionDetail(BaseModel):
    version_id: str
    song_id: str
    version_number: int
    label: Optional[str] = None
    notes: Optional[str] = None
    file_path: str
    has_reference: bool
    has_als: bool
    has_stems: bool
    created_at: str
    analyses: list[AnalysisInVersionDetail] = []
```

- [ ] **Step 3: Lint check**

Run: `ruff check components/api/app/schemas/`
Expected: `All checks passed!`

- [ ] **Step 4: Commit**

```bash
git add components/api/app/schemas/songs.py components/api/app/schemas/versions.py
git commit -m "feat(api): schemas for songs+versions endpoints"
```

---

## Task 5: Songs router — create song

**Files:**
- Rewrite: `components/api/app/routers/songs.py`
- Create: `components/api/tests/test_songs_router.py`

This task and the next four (Tasks 6–9) all live in the same router file. We build it up endpoint-by-endpoint with TDD.

- [ ] **Step 1: Write the failing test for `POST /songs/`**

Create `components/api/tests/test_songs_router.py`:

```python
"""Tests for /songs/ endpoints."""
from __future__ import annotations

import uuid
import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def fake_user_factory():
    from app.models import User
    def _make(**kwargs):
        return User(
            id=kwargs.get("id", uuid.uuid4()),
            email=kwargs.get("email", f"u{uuid.uuid4()}@x.com"),
            hashed_password="hash",
        )
    return _make


@pytest.fixture
async def authed_client(fake_user_factory):
    """An async test client with auth + DB session faked. Use `.user` to get the user."""
    from app.db import get_session
    from app.main import app
    from app.routers.auth import get_current_user
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
    from aimusic_shared.models import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    user = fake_user_factory()

    async def _override_session():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = lambda: user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        ac.user = user  # type: ignore[attr-defined]
        ac.session_factory = Session  # type: ignore[attr-defined]
        # Seed the user row so FK constraints behave on backends that enforce them
        async with Session() as s:
            s.add(user)
            await s.commit()
        yield ac

    app.dependency_overrides.clear()
    await engine.dispose()


class TestCreateSong:
    async def test_creates_song_with_minimal_body(self, authed_client):
        r = await authed_client.post("/songs/", json={"name": "Track One"})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["name"] == "Track One"
        assert body["version_count"] == 0
        assert "song_id" in body

    async def test_rejects_duplicate_name_for_same_user(self, authed_client):
        await authed_client.post("/songs/", json={"name": "Dup"})
        r = await authed_client.post("/songs/", json={"name": "Dup"})
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "song_name_in_use"

    async def test_requires_auth(self):
        from app.main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/songs/", json={"name": "X"})
        assert r.status_code == 401
```

- [ ] **Step 2: Run the test — it should fail**

Run: `pytest -q components/api/tests/test_songs_router.py::TestCreateSong -v`
Expected: failures (POST endpoint returns 405 or doesn't exist).

- [ ] **Step 3: Write the `POST /songs/` handler**

Rewrite `components/api/app/routers/songs.py` — start with **only** the create endpoint, we'll grow the file in subsequent tasks:

```python
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from aimusic_shared.models import Song, SongVersion, UploadJob

from ..db import get_session
from ..models import User
from ..schemas.songs import (
    SongCreate, SongDetail, SongPatch, SongSummary, VersionInSongDetail,
)
from .auth import get_current_user

log = logging.getLogger(__name__)
router = APIRouter(prefix="/songs", tags=["songs"])


@router.post("/", status_code=201, response_model=SongSummary)
async def create_song(
    body: SongCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> SongSummary:
    song = Song(user_id=user.id, name=body.name.strip(), genre_hint=body.genre_hint)
    db.add(song)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": "song_name_in_use", "message": "You already have a song with that name."},
        )
    await db.refresh(song)
    return SongSummary(
        song_id=str(song.id), name=song.name, genre_hint=song.genre_hint,
        version_count=0, latest_version_id=None, latest_job_id=None,
        latest_score=None, latest_grade=None, last_analyzed=None,
        created_at=song.created_at.isoformat(),
    )
```

Also remove the legacy `tracks` router from `components/api/app/main.py` so the test app doesn't try to import deleted code later. Edit lines 15 and 51 of `main.py`:
- Delete the line `from .routers import tracks as tracks_router`
- Delete the line `app.include_router(tracks_router.router, prefix="/tracks", tags=["tracks"])`

- [ ] **Step 4: Run the test — should pass**

Run: `pytest -q components/api/tests/test_songs_router.py::TestCreateSong -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add components/api/app/routers/songs.py components/api/app/main.py components/api/tests/test_songs_router.py
git commit -m "feat(api): POST /songs/ (create) + drop tracks router from main"
```

---

## Task 6: Songs router — list, detail, patch

**Files:**
- Modify: `components/api/app/routers/songs.py`
- Modify: `components/api/tests/test_songs_router.py`

- [ ] **Step 1: Add failing tests for list, detail, patch**

Append to `test_songs_router.py`:

```python
class TestListSongs:
    async def test_empty_list(self, authed_client):
        r = await authed_client.get("/songs/")
        assert r.status_code == 200
        assert r.json() == []

    async def test_lists_songs_newest_first(self, authed_client):
        await authed_client.post("/songs/", json={"name": "A"})
        await authed_client.post("/songs/", json={"name": "B"})
        r = await authed_client.get("/songs/")
        assert r.status_code == 200
        names = [s["name"] for s in r.json()]
        assert set(names) == {"A", "B"}
        assert all(s["version_count"] == 0 for s in r.json())

    async def test_excludes_archived(self, authed_client):
        c = await authed_client.post("/songs/", json={"name": "Z"})
        sid = c.json()["song_id"]
        await authed_client.delete(f"/songs/{sid}")
        r = await authed_client.get("/songs/")
        assert r.json() == []


class TestSongDetail:
    async def test_detail_includes_empty_versions(self, authed_client):
        c = await authed_client.post("/songs/", json={"name": "D"})
        sid = c.json()["song_id"]
        r = await authed_client.get(f"/songs/{sid}")
        assert r.status_code == 200
        body = r.json()
        assert body["name"] == "D"
        assert body["versions"] == []

    async def test_detail_404_when_not_found(self, authed_client):
        r = await authed_client.get(f"/songs/{uuid.uuid4()}")
        assert r.status_code == 404


class TestPatchSong:
    async def test_rename(self, authed_client):
        c = await authed_client.post("/songs/", json={"name": "Old"})
        sid = c.json()["song_id"]
        r = await authed_client.patch(f"/songs/{sid}", json={"name": "New"})
        assert r.status_code == 200
        assert r.json()["name"] == "New"

    async def test_patch_conflict(self, authed_client):
        await authed_client.post("/songs/", json={"name": "Taken"})
        c = await authed_client.post("/songs/", json={"name": "Other"})
        sid = c.json()["song_id"]
        r = await authed_client.patch(f"/songs/{sid}", json={"name": "Taken"})
        assert r.status_code == 409
```

- [ ] **Step 2: Run, expect failure**

Run: `pytest -q components/api/tests/test_songs_router.py -v`
Expected: 7 of 10 fail (the list/detail/patch tests fail; the 3 create tests still pass).

- [ ] **Step 3: Add list/detail/patch + DELETE-stub to `songs.py`**

Append to `components/api/app/routers/songs.py`:

```python
def _build_song_summary(song: Song, versions: list[SongVersion], jobs_by_version: dict, analyses: dict) -> SongSummary:
    latest_version = versions[0] if versions else None  # versions ordered newest first
    latest_job = None
    latest_score = latest_grade = last_analyzed = None
    if latest_version:
        v_jobs = jobs_by_version.get(latest_version.id, [])
        completed = [j for j in v_jobs if j.status.value == "COMPLETE"]
        latest_job = completed[0] if completed else None
        if latest_job:
            a = analyses.get(latest_job.id)
            last_analyzed = latest_job.created_at.isoformat()
            if a and a.final_json:
                raw = a.final_json.get("overall_score")
                latest_score = float(raw) if raw is not None else None
                latest_grade = a.final_json.get("grade")
    return SongSummary(
        song_id=str(song.id),
        name=song.name,
        genre_hint=song.genre_hint,
        version_count=len(versions),
        latest_version_id=str(latest_version.id) if latest_version else None,
        latest_job_id=str(latest_job.id) if latest_job else None,
        latest_score=latest_score,
        latest_grade=latest_grade,
        last_analyzed=last_analyzed,
        created_at=song.created_at.isoformat(),
    )


async def _load_song_or_404(db: AsyncSession, song_id: uuid.UUID, user_id: uuid.UUID) -> Song:
    song = (await db.execute(
        select(Song).where(Song.id == song_id, Song.user_id == user_id, Song.archived_at.is_(None))
    )).scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


@router.get("/", response_model=list[SongSummary])
async def list_songs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> list[SongSummary]:
    songs = (await db.execute(
        select(Song)
        .where(Song.user_id == user.id, Song.archived_at.is_(None))
        .order_by(Song.updated_at.desc())
    )).scalars().all()
    if not songs:
        return []

    song_ids = [s.id for s in songs]
    versions = (await db.execute(
        select(SongVersion).where(SongVersion.song_id.in_(song_ids)).order_by(SongVersion.created_at.desc())
    )).scalars().all()
    versions_by_song: dict[uuid.UUID, list[SongVersion]] = {}
    for v in versions:
        versions_by_song.setdefault(v.song_id, []).append(v)

    version_ids = [v.id for v in versions]
    jobs: list[UploadJob] = []
    if version_ids:
        jobs = (await db.execute(
            select(UploadJob).where(UploadJob.version_id.in_(version_ids))
            .order_by(UploadJob.created_at.desc())
        )).scalars().all()
    jobs_by_version: dict[uuid.UUID, list[UploadJob]] = {}
    for j in jobs:
        if j.version_id is not None:
            jobs_by_version.setdefault(j.version_id, []).append(j)

    job_ids = [j.id for j in jobs]
    from aimusic_shared.models import AnalysisResult
    analyses = {}
    if job_ids:
        rows = (await db.execute(
            select(AnalysisResult).where(AnalysisResult.job_id.in_(job_ids))
        )).scalars().all()
        analyses = {a.job_id: a for a in rows}

    return [
        _build_song_summary(s, versions_by_song.get(s.id, []), jobs_by_version, analyses)
        for s in songs
    ]


@router.get("/{song_id}", response_model=SongDetail)
async def get_song(
    song_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> SongDetail:
    song = await _load_song_or_404(db, song_id, user.id)
    versions = (await db.execute(
        select(SongVersion).where(SongVersion.song_id == song.id)
        .order_by(SongVersion.created_at.desc())
    )).scalars().all()

    version_ids = [v.id for v in versions]
    jobs: list[UploadJob] = []
    if version_ids:
        jobs = (await db.execute(
            select(UploadJob).where(UploadJob.version_id.in_(version_ids))
            .order_by(UploadJob.created_at.desc())
        )).scalars().all()
    jobs_by_version: dict[uuid.UUID, list[UploadJob]] = {}
    for j in jobs:
        if j.version_id is not None:
            jobs_by_version.setdefault(j.version_id, []).append(j)

    from aimusic_shared.models import AnalysisResult
    job_ids = [j.id for j in jobs]
    analyses = {}
    if job_ids:
        rows = (await db.execute(
            select(AnalysisResult).where(AnalysisResult.job_id.in_(job_ids))
        )).scalars().all()
        analyses = {a.job_id: a for a in rows}

    summary = _build_song_summary(song, versions, jobs_by_version, analyses)
    version_dtos: list[VersionInSongDetail] = []
    for v in versions:
        v_jobs = jobs_by_version.get(v.id, [])
        completed = [j for j in v_jobs if j.status.value == "COMPLETE"]
        latest_job = completed[0] if completed else None
        score = grade = None
        if latest_job:
            a = analyses.get(latest_job.id)
            if a and a.final_json:
                raw = a.final_json.get("overall_score")
                score = float(raw) if raw is not None else None
                grade = a.final_json.get("grade")
        version_dtos.append(VersionInSongDetail(
            version_id=str(v.id),
            version_number=v.version_number,
            label=v.label,
            notes=v.notes,
            created_at=v.created_at.isoformat(),
            latest_job_id=str(latest_job.id) if latest_job else None,
            latest_score=score,
            latest_grade=grade,
            analysis_count=len(v_jobs),
        ))

    return SongDetail(
        song_id=summary.song_id,
        name=summary.name,
        genre_hint=summary.genre_hint,
        version_count=summary.version_count,
        latest_version_id=summary.latest_version_id,
        latest_job_id=summary.latest_job_id,
        latest_score=summary.latest_score,
        latest_grade=summary.latest_grade,
        last_analyzed=summary.last_analyzed,
        created_at=summary.created_at,
        versions=version_dtos,
        archived_at=song.archived_at.isoformat() if song.archived_at else None,
    )


@router.patch("/{song_id}", response_model=SongSummary)
async def patch_song(
    song_id: uuid.UUID,
    body: SongPatch,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> SongSummary:
    song = await _load_song_or_404(db, song_id, user.id)
    if body.name is not None:
        song.name = body.name.strip()
    if body.genre_hint is not None:
        song.genre_hint = body.genre_hint
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": "song_name_in_use", "message": "You already have a song with that name."},
        )
    await db.refresh(song)
    return _build_song_summary(song, [], {}, {})


@router.delete("/{song_id}", status_code=204)
async def delete_song(
    song_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    from datetime import datetime, timezone
    song = await _load_song_or_404(db, song_id, user.id)
    song.archived_at = datetime.now(timezone.utc)
    await db.commit()
    return None
```

- [ ] **Step 4: Run tests — should pass**

Run: `pytest -q components/api/tests/test_songs_router.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add components/api/app/routers/songs.py components/api/tests/test_songs_router.py
git commit -m "feat(api): GET /songs/, GET /songs/{id}, PATCH /songs/{id}, DELETE (soft)"
```

---

## Task 7: Songs router — restore + IDOR isolation

**Files:**
- Modify: `components/api/app/routers/songs.py`
- Modify: `components/api/tests/test_songs_router.py`

- [ ] **Step 1: Add failing tests**

Append to `test_songs_router.py`:

```python
class TestRestoreSong:
    async def test_restore_archived_song(self, authed_client):
        c = await authed_client.post("/songs/", json={"name": "R"})
        sid = c.json()["song_id"]
        await authed_client.delete(f"/songs/{sid}")
        r = await authed_client.post(f"/songs/{sid}/restore")
        assert r.status_code == 200
        listing = await authed_client.get("/songs/")
        assert any(s["song_id"] == sid for s in listing.json())

    async def test_restore_outside_window_returns_410(self, authed_client):
        from datetime import datetime, timedelta, timezone
        from aimusic_shared.models import Song
        c = await authed_client.post("/songs/", json={"name": "Old"})
        sid = c.json()["song_id"]
        await authed_client.delete(f"/songs/{sid}")
        # Manually push archived_at past the 30d window
        Session = authed_client.session_factory  # type: ignore[attr-defined]
        async with Session() as s:
            from sqlalchemy import select
            song = (await s.execute(select(Song).where(Song.id == sid))).scalar_one()
            song.archived_at = datetime.now(timezone.utc) - timedelta(days=31)
            await s.commit()
        r = await authed_client.post(f"/songs/{sid}/restore")
        assert r.status_code == 410


class TestIDOR:
    async def test_cannot_access_other_users_song(self, authed_client, fake_user_factory):
        from app.routers.auth import get_current_user
        from app.main import app
        # Create a song as the current user
        c = await authed_client.post("/songs/", json={"name": "Mine"})
        sid = c.json()["song_id"]
        # Now switch to a different user via the dependency override
        other = fake_user_factory()
        Session = authed_client.session_factory  # type: ignore[attr-defined]
        async with Session() as s:
            s.add(other)
            await s.commit()
        app.dependency_overrides[get_current_user] = lambda: other
        try:
            r = await authed_client.get(f"/songs/{sid}")
            assert r.status_code == 404
        finally:
            app.dependency_overrides[get_current_user] = lambda: authed_client.user  # type: ignore[attr-defined]
```

- [ ] **Step 2: Run, expect failure**

Run: `pytest -q components/api/tests/test_songs_router.py::TestRestoreSong -v`
Expected: 2 failures (no /restore endpoint).

- [ ] **Step 3: Add the restore endpoint to `songs.py`**

Append to `components/api/app/routers/songs.py`:

```python
RESTORE_WINDOW_DAYS = 30


@router.post("/{song_id}/restore", response_model=SongSummary)
async def restore_song(
    song_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> SongSummary:
    from datetime import datetime, timedelta, timezone
    song = (await db.execute(
        select(Song).where(Song.id == song_id, Song.user_id == user.id)
    )).scalar_one_or_none()
    if song is None or song.archived_at is None:
        raise HTTPException(status_code=404, detail="Song not found")
    cutoff = datetime.now(timezone.utc) - timedelta(days=RESTORE_WINDOW_DAYS)
    if song.archived_at < cutoff:
        raise HTTPException(status_code=410, detail="Restore window expired")
    song.archived_at = None
    await db.commit()
    await db.refresh(song)
    return _build_song_summary(song, [], {}, {})
```

- [ ] **Step 4: Run all songs tests — should pass**

Run: `pytest -q components/api/tests/test_songs_router.py -v`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add components/api/app/routers/songs.py components/api/tests/test_songs_router.py
git commit -m "feat(api): POST /songs/{id}/restore + IDOR isolation tests"
```

---

## Task 8: Versions router — create version (upload-to-library, no analysis)

**Files:**
- Create: `components/api/app/routers/versions.py`
- Create: `components/api/tests/test_versions_router.py`
- Modify: `components/api/app/main.py`

- [ ] **Step 1: Add a `versions` router import + mount in `main.py`**

Edit `components/api/app/main.py`. Add after the `songs as songs_router` import:
```python
from .routers import versions as versions_router
```
And after `app.include_router(songs_router.router)`:
```python
app.include_router(versions_router.router)
```

- [ ] **Step 2: Write the failing test**

Create `components/api/tests/test_versions_router.py`:

```python
"""Tests for /songs/{id}/versions and /versions/{id} endpoints."""
from __future__ import annotations

import io
import uuid
import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def fake_user_factory():
    from app.models import User
    def _make(**kwargs):
        return User(
            id=kwargs.get("id", uuid.uuid4()),
            email=kwargs.get("email", f"v{uuid.uuid4()}@x.com"),
            hashed_password="hash",
        )
    return _make


@pytest.fixture
async def authed_client(fake_user_factory):
    """Mirror of the conftest used in test_songs_router."""
    from app.db import get_session
    from app.main import app
    from app.routers.auth import get_current_user
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from aimusic_shared.models import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    user = fake_user_factory()

    async def _override_session():
        async with Session() as s:
            yield s

    app.dependency_overrides[get_session] = _override_session
    app.dependency_overrides[get_current_user] = lambda: user

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        ac.user = user  # type: ignore[attr-defined]
        ac.session_factory = Session  # type: ignore[attr-defined]
        async with Session() as s:
            s.add(user)
            await s.commit()
        yield ac

    app.dependency_overrides.clear()
    await engine.dispose()


WAV_HEADER = b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 100


@pytest.fixture
async def song_id(authed_client):
    r = await authed_client.post("/songs/", json={"name": "Track"})
    return r.json()["song_id"]


class TestCreateVersion:
    async def test_no_stems_creates_version_without_job(self, authed_client, song_id):
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        r = await authed_client.post(f"/songs/{song_id}/versions", files=files, data={"label": "rough"})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["version_number"] == 1
        assert body["label"] == "rough"
        # Ensure no UploadJob was created
        from aimusic_shared.models import UploadJob
        from sqlalchemy import select
        Session = authed_client.session_factory  # type: ignore[attr-defined]
        async with Session() as s:
            jobs = (await s.execute(select(UploadJob))).scalars().all()
            assert jobs == []

    async def test_version_number_increments(self, authed_client, song_id):
        files1 = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        await authed_client.post(f"/songs/{song_id}/versions", files=files1)
        files2 = {"file": ("b.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        r = await authed_client.post(f"/songs/{song_id}/versions", files=files2)
        assert r.json()["version_number"] == 2

    async def test_rejects_invalid_magic(self, authed_client, song_id):
        files = {"file": ("bad.wav", io.BytesIO(b"\x00\x00\x00\x00not audio"), "audio/wav")}
        r = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        assert r.status_code == 415

    async def test_404_on_unknown_song(self, authed_client):
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        r = await authed_client.post(f"/songs/{uuid.uuid4()}/versions", files=files)
        assert r.status_code == 404
```

- [ ] **Step 3: Run, expect failure**

Run: `pytest -q components/api/tests/test_versions_router.py -v`
Expected: import error or 404 on route.

- [ ] **Step 4: Implement `components/api/app/routers/versions.py`**

```python
from __future__ import annotations

import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from aimusic_shared.models import Song, SongVersion, UploadJob

from ..db import get_session
from ..models import User
from ..routers.uploads import validate_audio_magic, validate_als_magic, ALS_MAX_BYTES
from ..schemas.versions import VersionDetail, AnalysisInVersionDetail
from ..services.storage import get_storage
from .auth import get_current_user

log = logging.getLogger(__name__)
router = APIRouter(tags=["versions"])


async def _load_song(db: AsyncSession, song_id: uuid.UUID, user_id: uuid.UUID) -> Song:
    song = (await db.execute(
        select(Song).where(Song.id == song_id, Song.user_id == user_id, Song.archived_at.is_(None))
    )).scalar_one_or_none()
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


async def _load_version_through_song(db: AsyncSession, version_id: uuid.UUID, user_id: uuid.UUID) -> tuple[SongVersion, Song]:
    """IDOR-safe loader — joins through songs.user_id."""
    row = (await db.execute(
        select(SongVersion, Song)
        .join(Song, SongVersion.song_id == Song.id)
        .where(SongVersion.id == version_id, Song.user_id == user_id)
    )).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return row[0], row[1]


@router.post("/songs/{song_id}/versions", status_code=201, response_model=VersionDetail)
async def create_version(
    song_id: uuid.UUID,
    file: UploadFile = File(...),
    reference: UploadFile | None = File(None),
    als: UploadFile | None = File(None),
    label: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> VersionDetail:
    song = await _load_song(db, song_id, user.id)

    header = await file.read(12)
    if not validate_audio_magic(header):
        raise HTTPException(status_code=415, detail="Invalid audio format. Supported: MP3, FLAC, WAV")
    await file.seek(0)

    storage = get_storage()
    file_key = await storage.save(file)
    file_path = str(storage.get_path(file_key))

    reference_path: str | None = None
    if reference and reference.filename:
        ref_header = await reference.read(12)
        if not validate_audio_magic(ref_header):
            raise HTTPException(status_code=415, detail="Invalid reference audio format.")
        await reference.seek(0)
        ref_key = await storage.save(reference, prefix="ref_")
        reference_path = str(storage.get_path(ref_key))

    als_path: str | None = None
    if als and als.filename:
        if als.size and als.size > ALS_MAX_BYTES:
            raise HTTPException(status_code=413, detail="ALS file too large (max 50 MB)")
        als_header = await als.read(4)
        if not validate_als_magic(als_header):
            raise HTTPException(status_code=415, detail="Invalid ALS file")
        await als.seek(0)
        als_key = await storage.save(als, prefix="als_")
        als_path = str(storage.get_path(als_key))

    # Compute next version_number for this song
    max_n = (await db.execute(
        select(SongVersion.version_number)
        .where(SongVersion.song_id == song.id)
        .order_by(SongVersion.version_number.desc())
        .limit(1)
    )).scalar()
    next_n = (max_n or 0) + 1

    version = SongVersion(
        song_id=song.id, version_number=next_n,
        label=(label.strip() if label else None),
        notes=(notes.strip() if notes else None),
        file_path=file_path, reference_path=reference_path, als_file_path=als_path,
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)
    log.info("versions: created song=%s version=%s v_no=%s", song.id, version.id, next_n)

    return VersionDetail(
        version_id=str(version.id), song_id=str(song.id),
        version_number=version.version_number,
        label=version.label, notes=version.notes,
        file_path=version.file_path,
        has_reference=version.reference_path is not None,
        has_als=version.als_file_path is not None,
        has_stems=False,
        created_at=version.created_at.isoformat(),
        analyses=[],
    )
```

(Stem support is added in Task 14.)

- [ ] **Step 5: Run tests**

Run: `pytest -q components/api/tests/test_versions_router.py::TestCreateVersion -v`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add components/api/app/routers/versions.py components/api/app/main.py components/api/tests/test_versions_router.py
git commit -m "feat(api): POST /songs/{id}/versions — upload-to-library (no analysis)"
```

---

## Task 9: Versions router — GET, PATCH, DELETE

**Files:**
- Modify: `components/api/app/routers/versions.py`
- Modify: `components/api/tests/test_versions_router.py`

- [ ] **Step 1: Add failing tests**

Append to `test_versions_router.py`:

```python
class TestGetVersion:
    async def test_returns_detail(self, authed_client, song_id):
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        vid = c.json()["version_id"]
        r = await authed_client.get(f"/versions/{vid}")
        assert r.status_code == 200
        body = r.json()
        assert body["version_id"] == vid
        assert body["analyses"] == []

    async def test_404_other_user(self, authed_client, song_id, fake_user_factory):
        from app.routers.auth import get_current_user
        from app.main import app
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        vid = c.json()["version_id"]
        other = fake_user_factory()
        Session = authed_client.session_factory
        async with Session() as s:
            s.add(other); await s.commit()
        app.dependency_overrides[get_current_user] = lambda: other
        try:
            r = await authed_client.get(f"/versions/{vid}")
            assert r.status_code == 404
        finally:
            app.dependency_overrides[get_current_user] = lambda: authed_client.user


class TestPatchVersion:
    async def test_edit_label_notes(self, authed_client, song_id):
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        vid = c.json()["version_id"]
        r = await authed_client.patch(f"/versions/{vid}", json={"label": "mastered", "notes": "boosted 2k"})
        assert r.status_code == 200
        assert r.json()["label"] == "mastered"

    async def test_version_number_conflict_returns_409(self, authed_client, song_id):
        # Create v1 and v2; try to rename v2 to v1.
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        await authed_client.post(f"/songs/{song_id}/versions", files=files)
        files2 = {"file": ("b.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c2 = await authed_client.post(f"/songs/{song_id}/versions", files=files2)
        v2_id = c2.json()["version_id"]
        r = await authed_client.patch(f"/versions/{v2_id}", json={"version_number": 1})
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "version_number_in_use"
        assert r.json()["detail"]["proposed"] == 3


class TestDeleteVersion:
    async def test_delete_removes_version(self, authed_client, song_id):
        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        vid = c.json()["version_id"]
        r = await authed_client.delete(f"/versions/{vid}")
        assert r.status_code == 204
        r2 = await authed_client.get(f"/versions/{vid}")
        assert r2.status_code == 404
```

- [ ] **Step 2: Run, expect failure**

Run: `pytest -q components/api/tests/test_versions_router.py -v`
Expected: 5 failures (new tests fail).

- [ ] **Step 3: Add endpoints to `versions.py`**

Append to `components/api/app/routers/versions.py`:

```python
@router.get("/versions/{version_id}", response_model=VersionDetail)
async def get_version(
    version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> VersionDetail:
    version, _ = await _load_version_through_song(db, version_id, user.id)
    jobs = (await db.execute(
        select(UploadJob).where(UploadJob.version_id == version.id)
        .order_by(UploadJob.created_at.desc())
    )).scalars().all()

    from aimusic_shared.models import AnalysisResult
    job_ids = [j.id for j in jobs]
    analyses = {}
    if job_ids:
        rows = (await db.execute(
            select(AnalysisResult).where(AnalysisResult.job_id.in_(job_ids))
        )).scalars().all()
        analyses = {a.job_id: a for a in rows}

    analysis_dtos: list[AnalysisInVersionDetail] = []
    for j in jobs:
        a = analyses.get(j.id)
        score = grade = None
        if a and a.final_json:
            raw = a.final_json.get("overall_score")
            score = float(raw) if raw is not None else None
            grade = a.final_json.get("grade")
        analysis_dtos.append(AnalysisInVersionDetail(
            job_id=str(j.id), status=j.status.value,
            score=score, grade=grade,
            created_at=j.created_at.isoformat(),
            completed_at=j.completed_at.isoformat() if j.completed_at else None,
        ))

    return VersionDetail(
        version_id=str(version.id), song_id=str(version.song_id),
        version_number=version.version_number,
        label=version.label, notes=version.notes,
        file_path=version.file_path,
        has_reference=version.reference_path is not None,
        has_als=version.als_file_path is not None,
        has_stems=bool(version.stem_paths),
        created_at=version.created_at.isoformat(),
        analyses=analysis_dtos,
    )


@router.patch("/versions/{version_id}", response_model=VersionDetail)
async def patch_version(
    version_id: uuid.UUID,
    body: "VersionPatch",
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> VersionDetail:
    from sqlalchemy.exc import IntegrityError
    version, _ = await _load_version_through_song(db, version_id, user.id)
    if body.version_number is not None:
        version.version_number = body.version_number
    if body.label is not None:
        version.label = body.label.strip()
    if body.notes is not None:
        version.notes = body.notes
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # Find the next free version_number for this song
        max_n = (await db.execute(
            select(SongVersion.version_number)
            .where(SongVersion.song_id == version.song_id)
            .order_by(SongVersion.version_number.desc())
            .limit(1)
        )).scalar()
        proposed = (max_n or 0) + 1
        raise HTTPException(
            status_code=409,
            detail={"code": "version_number_in_use", "proposed": proposed},
        )
    await db.refresh(version)
    return await get_version(version_id, user, db)


@router.delete("/versions/{version_id}", status_code=204)
async def delete_version(
    version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    import os
    version, _ = await _load_version_through_song(db, version_id, user.id)
    # Best-effort disk cleanup
    for path in [version.file_path, version.reference_path, version.als_file_path]:
        if path:
            try:
                os.unlink(path)
            except OSError:
                log.warning("delete_version: could not unlink %s", path)
    await db.delete(version)
    await db.commit()
    return None
```

Add the import at top of `versions.py`:
```python
from ..schemas.versions import VersionPatch
```

- [ ] **Step 4: Run tests**

Run: `pytest -q components/api/tests/test_versions_router.py -v`
Expected: 9 passed.

- [ ] **Step 5: Commit**

```bash
git add components/api/app/routers/versions.py components/api/tests/test_versions_router.py
git commit -m "feat(api): GET/PATCH/DELETE /versions/{id}"
```

---

## Task 10: Versions router — analyze (run/rerun)

**Files:**
- Modify: `components/api/app/routers/versions.py`
- Modify: `components/api/tests/test_versions_router.py`

- [ ] **Step 1: Add failing tests**

Append to `test_versions_router.py`:

```python
class TestAnalyzeVersion:
    async def test_analyze_dispatches_celery(self, authed_client, song_id, monkeypatch):
        sent = {}
        def fake_dispatch(job_id, file_path, reference_path, user_id, **kw):
            sent["called"] = True
            sent["job_id"] = job_id
            sent["file_path"] = file_path
            return "task-123"
        from app.routers import versions as v_mod
        monkeypatch.setattr(v_mod, "dispatch_analysis_job", fake_dispatch)

        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        vid = c.json()["version_id"]
        r = await authed_client.post(f"/versions/{vid}/analyze")
        assert r.status_code == 202
        assert r.json()["job_id"]
        assert sent["called"]

    async def test_analyze_blocks_when_in_flight(self, authed_client, song_id, monkeypatch):
        from app.routers import versions as v_mod
        monkeypatch.setattr(v_mod, "dispatch_analysis_job", lambda *a, **kw: "tid")

        files = {"file": ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")}
        c = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        vid = c.json()["version_id"]
        await authed_client.post(f"/versions/{vid}/analyze")
        r = await authed_client.post(f"/versions/{vid}/analyze")
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "analysis_in_progress"
```

- [ ] **Step 2: Run, expect failure**

Run: `pytest -q components/api/tests/test_versions_router.py::TestAnalyzeVersion -v`
Expected: 2 fail (no /analyze endpoint).

- [ ] **Step 3: Implement /analyze**

Append to `components/api/app/routers/versions.py`:

```python
from aimusic_shared.models import JobStatus
from ..services.celery_client import dispatch_analysis_job


@router.post("/versions/{version_id}/analyze", status_code=202)
async def analyze_version(
    version_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> dict:
    version, song = await _load_version_through_song(db, version_id, user.id)
    # Guard against concurrent analyses on the same version
    in_flight = (await db.execute(
        select(UploadJob).where(
            UploadJob.version_id == version.id,
            UploadJob.status.in_([JobStatus.PENDING, JobStatus.PROCESSING, JobStatus.AWAITING_STEM_MAPPING]),
        ).limit(1)
    )).scalar_one_or_none()
    if in_flight is not None:
        raise HTTPException(
            status_code=409,
            detail={"code": "analysis_in_progress", "job_id": str(in_flight.id)},
        )

    initial_status = JobStatus.AWAITING_STEM_MAPPING if version.stem_paths_raw else JobStatus.PENDING
    stem_paths_arg = version.stem_paths if version.stem_paths else None

    job = UploadJob(
        user_id=user.id,
        version_id=version.id,
        file_path=version.file_path,
        reference_path=version.reference_path,
        als_file_path=version.als_file_path,
        genre_hint=song.genre_hint,
        status=initial_status,
        stem_paths_raw=version.stem_paths_raw,
        stem_paths=version.stem_paths,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # If no stems, dispatch Celery immediately.  Stems flow is handled via /versions/{id}/stems/confirm (Task 14).
    if initial_status == JobStatus.PENDING:
        try:
            task_id = dispatch_analysis_job(
                str(job.id), version.file_path, version.reference_path, str(user.id),
                als_file_path=version.als_file_path, genre_hint=song.genre_hint,
                stem_paths=stem_paths_arg,
            )
            job.task_id = task_id
            await db.commit()
        except Exception:
            log.exception("analyze_version: dispatch failed for job=%s", job.id)
            raise

    return {"job_id": str(job.id), "status": initial_status.value}
```

- [ ] **Step 4: Run tests**

Run: `pytest -q components/api/tests/test_versions_router.py -v`
Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add components/api/app/routers/versions.py components/api/tests/test_versions_router.py
git commit -m "feat(api): POST /versions/{id}/analyze with in-flight guard"
```

---

## Task 11: Save-to-library endpoint

**Files:**
- Modify: `components/api/app/routers/jobs.py`
- Create: `components/api/tests/test_save_to_library.py`
- Create: schema in `components/api/app/schemas/jobs.py`

- [ ] **Step 1: Add schema to `components/api/app/schemas/jobs.py`**

Read the existing file first, then append:

```python
from typing import Literal, Optional, Union
from uuid import UUID
from pydantic import BaseModel, Field


class SaveAsNewSong(BaseModel):
    action: Literal["new_song"]
    name: str = Field(..., min_length=1, max_length=200)
    genre_hint: Optional[str] = None
    label: Optional[str] = None
    notes: Optional[str] = None


class AddToExistingSong(BaseModel):
    action: Literal["add_to_song"]
    song_id: UUID
    label: Optional[str] = None
    notes: Optional[str] = None


SaveToLibraryBody = Union[SaveAsNewSong, AddToExistingSong]


class SaveToLibraryResult(BaseModel):
    song_id: str
    version_id: str
```

- [ ] **Step 2: Write the failing test**

Create `components/api/tests/test_save_to_library.py`:

```python
"""Tests for POST /jobs/{job_id}/save-to-library."""
from __future__ import annotations

import os
import tempfile
import uuid
import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def fake_user_factory():
    from app.models import User
    def _make(**kw):
        return User(
            id=kw.get("id", uuid.uuid4()),
            email=f"s{uuid.uuid4()}@x.com",
            hashed_password="h",
        )
    return _make


@pytest.fixture
async def authed_client(fake_user_factory):
    from app.db import get_session
    from app.main import app
    from app.routers.auth import get_current_user
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from aimusic_shared.models import Base

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    user = fake_user_factory()
    app.dependency_overrides[get_session] = lambda: _session_gen(Session)
    app.dependency_overrides[get_current_user] = lambda: user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        ac.user = user; ac.session_factory = Session
        async with Session() as s: s.add(user); await s.commit()
        yield ac
    app.dependency_overrides.clear(); await engine.dispose()


async def _session_gen(Session):
    async with Session() as s: yield s


async def _make_standalone_job(authed_client, *, file_exists=True):
    from aimusic_shared.models import UploadJob, JobStatus
    Session = authed_client.session_factory
    # Create a real file so save-to-library can succeed
    if file_exists:
        f = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        f.write(b"RIFF\x00\x00\x00\x00WAVE")
        f.close()
        path = f.name
    else:
        path = "/tmp/nonexistent.wav"
    async with Session() as s:
        job = UploadJob(user_id=authed_client.user.id, file_path=path, status=JobStatus.COMPLETE)
        s.add(job); await s.commit(); await s.refresh(job)
        return str(job.id), path


class TestSaveAsNewSong:
    async def test_creates_song_and_version(self, authed_client):
        job_id, _path = await _make_standalone_job(authed_client)
        r = await authed_client.post(
            f"/jobs/{job_id}/save-to-library",
            json={"action": "new_song", "name": "Brand New"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["song_id"] and body["version_id"]

        # Verify job is now linked to the new version
        from aimusic_shared.models import UploadJob
        from sqlalchemy import select
        async with authed_client.session_factory() as s:
            job = (await s.execute(select(UploadJob).where(UploadJob.id == job_id))).scalar_one()
            assert str(job.version_id) == body["version_id"]

    async def test_410_when_file_missing(self, authed_client):
        job_id, _ = await _make_standalone_job(authed_client, file_exists=False)
        r = await authed_client.post(
            f"/jobs/{job_id}/save-to-library",
            json={"action": "new_song", "name": "Should Fail"},
        )
        assert r.status_code == 410
        assert r.json()["detail"]["code"] == "audio_expired"


class TestAddToExisting:
    async def test_creates_next_version(self, authed_client):
        from aimusic_shared.models import Song
        Session = authed_client.session_factory
        # Pre-create a song with v1
        async with Session() as s:
            song = Song(user_id=authed_client.user.id, name="Existing")
            s.add(song); await s.commit(); await s.refresh(song)
            song_id = song.id

        job_id, _ = await _make_standalone_job(authed_client)
        r = await authed_client.post(
            f"/jobs/{job_id}/save-to-library",
            json={"action": "add_to_song", "song_id": str(song_id), "label": "v2 take"},
        )
        assert r.status_code == 200
        # v1 doesn't exist yet, so server-assigned version_number is 1
        from aimusic_shared.models import SongVersion
        from sqlalchemy import select
        async with Session() as s:
            v = (await s.execute(select(SongVersion).where(SongVersion.id == r.json()["version_id"]))).scalar_one()
            assert v.version_number == 1
            assert v.label == "v2 take"
```

- [ ] **Step 3: Run, expect failure**

Run: `pytest -q components/api/tests/test_save_to_library.py -v`
Expected: 3 failures (endpoint missing).

- [ ] **Step 4: Implement the endpoint in `jobs.py`**

Add at the bottom of `components/api/app/routers/jobs.py`:

```python
import os
from sqlalchemy.exc import IntegrityError
from aimusic_shared.models import Song, SongVersion
from ..schemas.jobs import SaveToLibraryResult, SaveAsNewSong, AddToExistingSong


@router.post("/{job_id}/save-to-library", response_model=SaveToLibraryResult)
async def save_to_library(
    job_id: str,
    body: dict,  # parse manually via discriminator
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SaveToLibraryResult:
    action = body.get("action")
    if action == "new_song":
        parsed = SaveAsNewSong(**body)
    elif action == "add_to_song":
        parsed = AddToExistingSong(**body)
    else:
        raise HTTPException(status_code=422, detail="Unknown action")

    # 1. Load job + IDOR check
    job = (await session.execute(
        select(UploadJob).where(UploadJob.id == job_id, UploadJob.user_id == current_user.id)
    )).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.version_id is not None:
        raise HTTPException(status_code=409, detail={"code": "already_saved", "version_id": str(job.version_id)})

    # 2. Verify the audio file still exists on disk
    if not job.file_path or not os.path.exists(job.file_path):
        raise HTTPException(
            status_code=410,
            detail={"code": "audio_expired", "message": "This recording has expired — please re-upload to save it."},
        )

    # 3. Get-or-create song
    if isinstance(parsed, SaveAsNewSong):
        song = Song(user_id=current_user.id, name=parsed.name.strip(), genre_hint=parsed.genre_hint)
        session.add(song)
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            raise HTTPException(status_code=409, detail={"code": "song_name_in_use"})
        label = parsed.label
        notes = parsed.notes
    else:  # AddToExistingSong
        song = (await session.execute(
            select(Song).where(Song.id == parsed.song_id, Song.user_id == current_user.id, Song.archived_at.is_(None))
        )).scalar_one_or_none()
        if song is None:
            raise HTTPException(status_code=404, detail="Song not found")
        label = parsed.label
        notes = parsed.notes

    # 4. Server-assign next version_number for this song
    max_n = (await session.execute(
        select(SongVersion.version_number)
        .where(SongVersion.song_id == song.id)
        .order_by(SongVersion.version_number.desc())
        .limit(1)
    )).scalar()
    next_n = (max_n or 0) + 1

    # 5. Create SongVersion pointing at the same file_path
    version = SongVersion(
        song_id=song.id,
        version_number=next_n,
        label=label.strip() if label else None,
        notes=notes,
        file_path=job.file_path,
        reference_path=job.reference_path,
        als_file_path=job.als_file_path,
    )
    session.add(version)
    await session.flush()

    # 6. Link the job
    job.version_id = version.id
    await session.commit()

    return SaveToLibraryResult(song_id=str(song.id), version_id=str(version.id))
```

- [ ] **Step 5: Run tests**

Run: `pytest -q components/api/tests/test_save_to_library.py -v`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add components/api/app/routers/jobs.py components/api/app/schemas/jobs.py components/api/tests/test_save_to_library.py
git commit -m "feat(api): POST /jobs/{id}/save-to-library"
```

---

## Task 12: Drop `track_name` from POST /uploads/

**Files:**
- Modify: `components/api/app/routers/uploads.py`

- [ ] **Step 1: Remove the Song-upsert logic from uploads.py**

Open `components/api/app/routers/uploads.py`. Find the block starting `# --- Upsert Song record if a track name was provided ---` (around line 177) and the `track_name` form parameter (around line 76).

Replace the function signature line that reads:
```python
    track_name: str | None = Form(None),
```
… by deleting it entirely.

Delete the whole `# --- Upsert Song record if a track name was provided ---` block (around lines 177–204).

In the `UploadJob(...)` constructor call (around line 210), remove `song_id=song_id,` and `track_name=clean_name,`. The `UploadJob` constructor should no longer mention either.

Also remove the `clean_name` line — it's now unused.

- [ ] **Step 2: Verify the upload tests still pass**

Run: `pytest -q components/api/tests/test_uploads.py -v`
Expected: all pass (the existing tests didn't depend on track_name).

- [ ] **Step 3: Commit**

```bash
git add components/api/app/routers/uploads.py
git commit -m "refactor(api): drop track_name + auto-Song-upsert from POST /uploads/"
```

---

## Task 13: Delete legacy tracks router

**Files:**
- Delete: `components/api/app/routers/tracks.py`
- Modify: `components/api/app/schemas/jobs.py` (drop `TrackGroup`/`TrackVersionSummary` if exclusively used by tracks)

- [ ] **Step 1: Delete the tracks router**

Run: `git rm components/api/app/routers/tracks.py`

- [ ] **Step 2: Drop the now-unused schemas**

Open `components/api/app/schemas/jobs.py`. If `TrackGroup` and `TrackVersionSummary` are not imported anywhere else (grep first), remove them.

Run: `Grep TrackGroup components/`
If the only matches are inside `tracks.py` (already deleted) and the schema file, delete the class definitions.

- [ ] **Step 3: Run the full API test suite**

Run: `pytest -q components/api/tests/ -v`
Expected: all pass; nothing references the removed schemas.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(api): remove legacy /tracks router and TrackGroup schemas"
```

---

## Task 14: Versions router — stems upload + confirm

**Files:**
- Modify: `components/api/app/routers/versions.py`
- Modify: `components/api/tests/test_versions_router.py`

- [ ] **Step 1: Add failing test**

Append to `test_versions_router.py`:

```python
class TestVersionStems:
    async def test_create_version_with_stems_returns_proposed_mapping(self, authed_client, song_id, monkeypatch):
        # Bypass real stem validation by patching it to no-op
        from app.routers import versions as v_mod
        def _ok(_bufs): return None
        monkeypatch.setattr("app.services.stem_validation.validate_stem_uploads", _ok)
        # Patch propose_mapping to return an empty list (no real stem files present)
        monkeypatch.setattr("audio_analysis.stems.propose_mapping", lambda paths, names=None: [])

        files = [
            ("file", ("a.wav", io.BytesIO(WAV_HEADER), "audio/wav")),
            ("stems", ("kick.wav", io.BytesIO(WAV_HEADER), "audio/wav")),
        ]
        r = await authed_client.post(f"/songs/{song_id}/versions", files=files)
        assert r.status_code == 201
        body = r.json()
        assert body.get("has_stems") is True
        assert "proposed_mapping" in body
```

- [ ] **Step 2: Run, expect failure**

Run: `pytest -q components/api/tests/test_versions_router.py::TestVersionStems -v`
Expected: fail (versions endpoint doesn't accept stems yet).

- [ ] **Step 3: Extend the `create_version` handler to accept stems**

In `components/api/app/routers/versions.py`, extend the `create_version` signature to accept `stems: list[UploadFile] | None = File(None)` and `reference_stems: list[UploadFile] | None = File(None)`. Reuse the helper pattern from `uploads.py::_save_stem_group`.

Add at the top of `versions.py`:
```python
from pathlib import Path

from ..services.stem_validation import StemValidationError, validate_stem_uploads
from ..routers.uploads import _StemBuf, _validation_error_status, _parse_als_track_names
```

Inside `create_version`, after saving the ALS file and before computing `next_n`:

```python
    # --- Stems ---
    async def _save_stem_group(uploads, prefix):
        if not uploads: return []
        real = [u for u in uploads if u.filename]
        if not real: return []
        bufs = []
        for u in real:
            payload = await u.read(); await u.seek(0)
            bufs.append(_StemBuf(u.filename, payload))
        try:
            validate_stem_uploads(bufs)
        except StemValidationError as e:
            raise HTTPException(
                status_code=_validation_error_status(e.code),
                detail={"code": e.code, "message": e.message, "file": e.file},
            )
        saved = []
        for u in real:
            key = await storage.save(u, prefix=prefix)
            saved.append(str(storage.get_path(key)))
        return saved

    stem_paths_raw = await _save_stem_group(stems, "stem_")
```

And update the SongVersion constructor:
```python
    version = SongVersion(
        song_id=song.id, version_number=next_n,
        label=(label.strip() if label else None),
        notes=(notes.strip() if notes else None),
        file_path=file_path, reference_path=reference_path, als_file_path=als_path,
        stem_paths_raw=stem_paths_raw or None,
    )
```

Then, if stems were uploaded, generate the proposed mapping and return it alongside the VersionDetail. Update the response shape to include an optional `proposed_mapping` field — extend the `VersionDetail` schema in Task 4:

In `components/api/app/schemas/versions.py`, add:

```python
class StemMappingProposalDTO(BaseModel):
    file: str
    proposed_role: str
    proposed_als_track: Optional[str] = None
    confidence: float


class VersionDetail(BaseModel):
    # ... existing fields ...
    proposed_mapping: Optional[list[StemMappingProposalDTO]] = None
    als_track_names: list[str] = []
```

(Add `proposed_mapping` and `als_track_names` to the existing `VersionDetail` class — don't redefine the class.)

Then at the end of `create_version`, after `await db.commit(); await db.refresh(version)`:

```python
    proposed_mapping = None
    als_track_names = None
    if stem_paths_raw:
        from audio_analysis.stems import propose_mapping
        from ..schemas.versions import StemMappingProposalDTO
        als_track_names = _parse_als_track_names(als_path) if als_path else None
        proposals = propose_mapping([Path(p) for p in stem_paths_raw], als_track_names)
        proposed_mapping = [
            StemMappingProposalDTO(
                file=p.file.name, proposed_role=p.proposed_role.value,
                proposed_als_track=p.proposed_als_track, confidence=p.confidence,
            ) for p in proposals
        ]
```

Include them in the returned `VersionDetail`:
```python
        has_stems=bool(stem_paths_raw),
        proposed_mapping=proposed_mapping,
        als_track_names=als_track_names or [],
```

- [ ] **Step 4: Add `POST /versions/{id}/stems/confirm`**

Append to `versions.py`:

```python
from ..schemas.uploads import StemMappingConfirmDTO  # reuse existing


@router.post("/versions/{version_id}/stems/confirm", status_code=200)
async def confirm_version_stems(
    version_id: uuid.UUID,
    body: list[StemMappingConfirmDTO],
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
) -> dict:
    version, _ = await _load_version_through_song(db, version_id, user.id)
    if not version.stem_paths_raw:
        raise HTTPException(status_code=409, detail="Version has no pending stem mapping")

    # Map filename -> path
    by_name = {Path(p).name: p for p in version.stem_paths_raw}
    confirmed: dict[str, str] = {}
    for entry in body:
        path = by_name.get(entry.file)
        if path is None:
            raise HTTPException(status_code=422, detail=f"Unknown stem file: {entry.file}")
        confirmed[entry.role] = path

    version.stem_paths = confirmed
    await db.commit()
    return {"version_id": str(version.id), "stem_paths": confirmed}
```

- [ ] **Step 5: Run tests**

Run: `pytest -q components/api/tests/test_versions_router.py -v`
Expected: all pass (12+ tests).

- [ ] **Step 6: Commit**

```bash
git add components/api/app/routers/versions.py components/api/app/schemas/versions.py components/api/tests/test_versions_router.py
git commit -m "feat(api): stems upload + /versions/{id}/stems/confirm"
```

---

## Task 15: Beat task — cleanup orphan uploads

**Files:**
- Modify: `components/worker/app/tasks_cleanup.py`
- Modify: `components/worker/app/celery_app.py`
- Create: `components/api/tests/test_cleanup_tasks.py`

- [ ] **Step 1: Write failing test**

Create `components/api/tests/test_cleanup_tasks.py`:

```python
"""Tests for beat-task cleanups."""
from __future__ import annotations

import os
import tempfile
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select


@pytest.fixture
async def db():
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
    from aimusic_shared.models import Base
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Session = async_sessionmaker(engine, expire_on_commit=False)
    yield Session
    await engine.dispose()


class TestOrphanCleanup:
    async def test_purges_old_standalone_jobs(self, db, monkeypatch):
        from aimusic_shared.models import User, UploadJob, JobStatus
        from app.tasks_cleanup import cleanup_orphan_uploads, ORPHAN_TTL_DAYS  # noqa: F401

        f = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        f.write(b"x"); f.close()
        path = f.name

        async with db() as s:
            u = User(id=uuid.uuid4(), email="u@x.com", hashed_password="h")
            s.add(u); await s.commit(); await s.refresh(u)
            old = UploadJob(
                user_id=u.id, file_path=path, status=JobStatus.COMPLETE,
                version_id=None,
            )
            s.add(old); await s.commit(); await s.refresh(old)
            # Force created_at to be old
            old.created_at = datetime.now(timezone.utc) - timedelta(days=31)
            await s.commit()
            old_id = old.id

        # Patch the task's session factory to use our in-memory engine
        import app.tasks_cleanup as tc
        monkeypatch.setattr(tc, "_async_session_factory", lambda: db())

        await cleanup_orphan_uploads()
        assert not os.path.exists(path)

        async with db() as s:
            j = (await s.execute(select(UploadJob).where(UploadJob.id == old_id))).scalar_one()
            assert j.file_path is None

    async def test_keeps_recent_jobs(self, db, monkeypatch):
        from aimusic_shared.models import User, UploadJob, JobStatus
        from app.tasks_cleanup import cleanup_orphan_uploads

        f = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        f.write(b"x"); f.close()
        path = f.name

        async with db() as s:
            u = User(id=uuid.uuid4(), email="u2@x.com", hashed_password="h")
            s.add(u); await s.commit(); await s.refresh(u)
            recent = UploadJob(user_id=u.id, file_path=path, status=JobStatus.COMPLETE, version_id=None)
            s.add(recent); await s.commit()

        import app.tasks_cleanup as tc
        monkeypatch.setattr(tc, "_async_session_factory", lambda: db())
        await cleanup_orphan_uploads()
        assert os.path.exists(path)
        os.unlink(path)

    async def test_keeps_jobs_linked_to_versions(self, db, monkeypatch):
        from aimusic_shared.models import User, Song, SongVersion, UploadJob, JobStatus
        from app.tasks_cleanup import cleanup_orphan_uploads

        f = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        f.write(b"x"); f.close()
        path = f.name

        async with db() as s:
            u = User(id=uuid.uuid4(), email="u3@x.com", hashed_password="h")
            s.add(u); await s.commit(); await s.refresh(u)
            song = Song(user_id=u.id, name="N"); s.add(song); await s.commit(); await s.refresh(song)
            v = SongVersion(song_id=song.id, version_number=1, file_path=path); s.add(v); await s.commit(); await s.refresh(v)
            old_linked = UploadJob(
                user_id=u.id, file_path=path, status=JobStatus.COMPLETE, version_id=v.id,
            )
            s.add(old_linked); await s.commit(); await s.refresh(old_linked)
            old_linked.created_at = datetime.now(timezone.utc) - timedelta(days=60)
            await s.commit()

        import app.tasks_cleanup as tc
        monkeypatch.setattr(tc, "_async_session_factory", lambda: db())
        await cleanup_orphan_uploads()
        assert os.path.exists(path)  # protected by version link
        os.unlink(path)
```

- [ ] **Step 2: Run, expect failure**

Run: `pytest -q components/api/tests/test_cleanup_tasks.py -v`
Expected: 3 fail (cleanup function doesn't exist).

- [ ] **Step 3: Implement the task in `components/worker/app/tasks_cleanup.py`**

Append:

```python
ORPHAN_TTL_DAYS = 30


async def cleanup_orphan_uploads() -> None:
    """Purge audio files for standalone UploadJobs older than ORPHAN_TTL_DAYS.

    Standalone = version_id IS NULL. Linked jobs are protected.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=ORPHAN_TTL_DAYS)
    async with _async_session_factory() as session:
        result = await session.execute(
            select(UploadJob).where(
                UploadJob.version_id.is_(None),
                UploadJob.created_at < cutoff,
                UploadJob.file_path.isnot(None),
            )
        )
        jobs = list(result.scalars().all())

        for job in jobs:
            for path_attr in ("file_path", "reference_path", "als_file_path"):
                p = getattr(job, path_attr)
                if p:
                    try:
                        Path(p).unlink(missing_ok=True)
                    except OSError as exc:
                        log.warning("cleanup_orphan_uploads: could not unlink %s: %s", p, exc)
                    setattr(job, path_attr, None)
            log.info("cleanup_orphan_uploads: purged job=%s", job.id)
        await session.commit()


@shared_task(name="app.tasks_cleanup.cleanup_orphan_uploads_task")
def cleanup_orphan_uploads_task() -> None:
    asyncio.run(cleanup_orphan_uploads())
```

- [ ] **Step 4: Register the beat schedule**

Edit `components/worker/app/celery_app.py`. Add to `beat_schedule`:

```python
        "cleanup-orphan-uploads": {
            "task": "app.tasks_cleanup.cleanup_orphan_uploads_task",
            "schedule": 86400.0,  # daily
        },
```

- [ ] **Step 5: Run tests**

Run: `pytest -q components/api/tests/test_cleanup_tasks.py::TestOrphanCleanup -v`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add components/worker/app/tasks_cleanup.py components/worker/app/celery_app.py components/api/tests/test_cleanup_tasks.py
git commit -m "feat(worker): cleanup_orphan_uploads beat task (30d TTL)"
```

---

## Task 16: Beat task — purge archived songs

**Files:**
- Modify: `components/worker/app/tasks_cleanup.py`
- Modify: `components/worker/app/celery_app.py`
- Modify: `components/api/tests/test_cleanup_tasks.py`

- [ ] **Step 1: Add failing test**

Append to `test_cleanup_tasks.py`:

```python
class TestPurgeArchivedSongs:
    async def test_purges_song_after_window(self, db, monkeypatch):
        from aimusic_shared.models import User, Song, SongVersion
        from app.tasks_cleanup import purge_archived_songs, ARCHIVE_TTL_DAYS  # noqa

        f = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
        f.write(b"x"); f.close()
        path = f.name

        async with db() as s:
            u = User(id=uuid.uuid4(), email="a1@x.com", hashed_password="h")
            s.add(u); await s.commit(); await s.refresh(u)
            song = Song(
                user_id=u.id, name="Old",
                archived_at=datetime.now(timezone.utc) - timedelta(days=31),
            )
            s.add(song); await s.commit(); await s.refresh(song)
            v = SongVersion(song_id=song.id, version_number=1, file_path=path)
            s.add(v); await s.commit()
            song_id = song.id

        import app.tasks_cleanup as tc
        monkeypatch.setattr(tc, "_async_session_factory", lambda: db())
        await purge_archived_songs()

        async with db() as s:
            from aimusic_shared.models import Song as S2
            row = (await s.execute(select(S2).where(S2.id == song_id))).scalar_one_or_none()
            assert row is None
        assert not os.path.exists(path)

    async def test_keeps_recently_archived(self, db, monkeypatch):
        from aimusic_shared.models import User, Song
        from app.tasks_cleanup import purge_archived_songs

        async with db() as s:
            u = User(id=uuid.uuid4(), email="a2@x.com", hashed_password="h")
            s.add(u); await s.commit(); await s.refresh(u)
            song = Song(user_id=u.id, name="Recent",
                        archived_at=datetime.now(timezone.utc) - timedelta(days=5))
            s.add(song); await s.commit()
            song_id = song.id

        import app.tasks_cleanup as tc
        monkeypatch.setattr(tc, "_async_session_factory", lambda: db())
        await purge_archived_songs()

        async with db() as s:
            from aimusic_shared.models import Song as S2
            row = (await s.execute(select(S2).where(S2.id == song_id))).scalar_one_or_none()
            assert row is not None  # still archived, not yet purged
```

- [ ] **Step 2: Run, expect failure**

Run: `pytest -q components/api/tests/test_cleanup_tasks.py::TestPurgeArchivedSongs -v`
Expected: 2 fail.

- [ ] **Step 3: Implement**

Append to `components/worker/app/tasks_cleanup.py`:

```python
ARCHIVE_TTL_DAYS = 30


async def purge_archived_songs() -> None:
    """Hard-delete songs whose archived_at is older than ARCHIVE_TTL_DAYS.

    Cascades through SongVersion → UploadJob → AnalysisResult via DB constraints.
    Also unlinks audio files on disk.
    """
    from aimusic_shared.models import Song, SongVersion

    cutoff = datetime.now(timezone.utc) - timedelta(days=ARCHIVE_TTL_DAYS)
    async with _async_session_factory() as session:
        songs = list((await session.execute(
            select(Song).where(
                Song.archived_at.isnot(None),
                Song.archived_at < cutoff,
            )
        )).scalars().all())

        for song in songs:
            versions = list((await session.execute(
                select(SongVersion).where(SongVersion.song_id == song.id)
            )).scalars().all())
            for v in versions:
                for p in (v.file_path, v.reference_path, v.als_file_path):
                    if p:
                        try:
                            Path(p).unlink(missing_ok=True)
                        except OSError as exc:
                            log.warning("purge_archived_songs: unlink %s failed: %s", p, exc)
            await session.delete(song)
            log.info("purge_archived_songs: hard-deleted song=%s", song.id)
        await session.commit()


@shared_task(name="app.tasks_cleanup.purge_archived_songs_task")
def purge_archived_songs_task() -> None:
    asyncio.run(purge_archived_songs())
```

- [ ] **Step 4: Add the beat schedule**

In `components/worker/app/celery_app.py`, add to `beat_schedule`:

```python
        "purge-archived-songs": {
            "task": "app.tasks_cleanup.purge_archived_songs_task",
            "schedule": 86400.0,
        },
```

- [ ] **Step 5: Run tests**

Run: `pytest -q components/api/tests/test_cleanup_tasks.py -v`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add components/worker/app/tasks_cleanup.py components/worker/app/celery_app.py components/api/tests/test_cleanup_tasks.py
git commit -m "feat(worker): purge_archived_songs beat task (30d after archive)"
```

---

## Task 17: Frontend API client extensions

**Files:**
- Modify: `components/frontend-spectr/src/api/songs.js`
- Create: `components/frontend-spectr/src/api/versions.js`
- Modify: `components/frontend-spectr/src/api/client.js`

- [ ] **Step 1: Rewrite `songs.js`**

Replace `components/frontend-spectr/src/api/songs.js` entirely with:

```js
import { apiRequest } from './client.js';

export const listSongs   = ()        => apiRequest('/songs/');
export const getSong     = (id)      => apiRequest(`/songs/${id}`);
export const createSong  = (body)    => apiRequest('/songs/', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
export const patchSong   = (id, body)=> apiRequest(`/songs/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
export const deleteSong  = (id)      => apiRequest(`/songs/${id}`, { method: 'DELETE' });
export const restoreSong = (id)      => apiRequest(`/songs/${id}/restore`, { method: 'POST' });
```

- [ ] **Step 2: Create `versions.js`**

```js
import { apiRequest } from './client.js';

export const getVersion    = (id)            => apiRequest(`/versions/${id}`);
export const patchVersion  = (id, body)      => apiRequest(`/versions/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
export const deleteVersion = (id)            => apiRequest(`/versions/${id}`, { method: 'DELETE' });
export const analyzeVersion= (id)            => apiRequest(`/versions/${id}/analyze`, { method: 'POST' });
export const confirmVersionStems = (id, mapping) =>
  apiRequest(`/versions/${id}/stems/confirm`, { method: 'POST', body: JSON.stringify(mapping), headers: { 'Content-Type': 'application/json' } });

/** Multipart upload — uses XHR so we can attach progress, mirroring useFileUpload pattern. */
export async function createVersion(songId, { file, reference, als, stems, label, notes, onProgress }) {
  const fd = new FormData();
  fd.append('file', file);
  if (reference) fd.append('reference', reference);
  if (als) fd.append('als', als);
  if (label) fd.append('label', label);
  if (notes) fd.append('notes', notes);
  if (stems) for (const s of stems) fd.append('stems', s);

  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Bad JSON in version response')); }
      } else {
        reject(new Error(`${xhr.status}: ${xhr.responseText}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.open('POST', `/api/songs/${songId}/versions`);
    xhr.withCredentials = true;
    xhr.send(fd);
  });
}
```

- [ ] **Step 3: Add `saveToLibrary` helper to `client.js`**

Open `components/frontend-spectr/src/api/client.js`. Find the existing exports and add:

```js
export const saveToLibrary = (jobId, body) =>
  apiRequest(`/jobs/${jobId}/save-to-library`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
```

- [ ] **Step 4: Build to check no syntax errors**

Run: `cd components/frontend-spectr && npm run build 2>&1 | tail -20`
Expected: build succeeds (the new functions aren't yet used, but should parse).

- [ ] **Step 5: Commit**

```bash
git add components/frontend-spectr/src/api/
git commit -m "feat(frontend): API client functions for songs+versions+saveToLibrary"
```

---

## Task 18: Frontend — NewSongModal + DeleteSongModal

**Files:**
- Create: `components/frontend-spectr/src/components/NewSongModal.jsx`
- Create: `components/frontend-spectr/src/components/DeleteSongModal.jsx`

- [ ] **Step 1: Create `NewSongModal.jsx`**

```jsx
import { useState } from 'react';
import { createSong } from '../api/songs.js';

const GENRES = ['', 'trance', 'house', 'techno', 'dnb', 'progressive'];

export default function NewSongModal({ onCancel, onCreated, onError }) {
  const [name, setName] = useState('');
  const [genre, setGenre] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      const song = await createSong({ name: name.trim(), genre_hint: genre || undefined });
      onCreated(song);
    } catch (e) {
      const msg = e?.message?.includes('409') ? 'You already have a song with that name.' : (e.message || 'Failed to create song');
      setErr(msg);
      onError?.(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>New Song</h2>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={200} required />
        </label>
        <label>
          Genre (optional)
          <select value={genre} onChange={(e) => setGenre(e.target.value)}>
            {GENRES.map((g) => <option key={g} value={g}>{g || '— none —'}</option>)}
          </select>
        </label>
        {err && <p className="error">{err}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Create `DeleteSongModal.jsx`**

```jsx
import { useState } from 'react';
import { deleteSong } from '../api/songs.js';

export default function DeleteSongModal({ song, onCancel, onDeleted }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const matches = typed.trim() === song.name;

  async function submit(e) {
    e.preventDefault();
    if (!matches) return;
    setBusy(true); setErr(null);
    try {
      await deleteSong(song.song_id);
      onDeleted(song.song_id);
    } catch (e) {
      setErr(e.message || 'Failed to delete'); setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Delete song?</h2>
        <p>This will archive <strong>{song.name}</strong>. You can restore it within 30 days.</p>
        <label>
          Type the song name to confirm:
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </label>
        {err && <p className="error">{err}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={!matches || busy}>{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Build to confirm parses**

Run: `cd components/frontend-spectr && npm run build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/frontend-spectr/src/components/NewSongModal.jsx components/frontend-spectr/src/components/DeleteSongModal.jsx
git commit -m "feat(frontend): NewSongModal + DeleteSongModal"
```

---

## Task 19: Frontend — AddVersionModal

**Files:**
- Create: `components/frontend-spectr/src/components/AddVersionModal.jsx`

- [ ] **Step 1: Create the component**

```jsx
import { useState } from 'react';
import { createVersion } from '../api/versions.js';

export default function AddVersionModal({ song, onCancel, onAdded }) {
  const [file, setFile] = useState(null);
  const [reference, setReference] = useState(null);
  const [als, setAls] = useState(null);
  const [stems, setStems] = useState([]);
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const v = await createVersion(song.song_id, {
        file, reference, als,
        stems: stems.length ? stems : undefined,
        label: label || undefined, notes: notes || undefined,
        onProgress: setProgress,
      });
      onAdded(v);
    } catch (e) {
      setErr(e.message || 'Upload failed'); setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Add Version to {song.name}</h2>
        <label>Audio (required)
          <input type="file" accept=".mp3,.flac,.wav" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
        </label>
        <label>Reference (optional)
          <input type="file" accept=".mp3,.flac,.wav" onChange={(e) => setReference(e.target.files?.[0] ?? null)} />
        </label>
        <label>ALS project (optional)
          <input type="file" accept=".als" onChange={(e) => setAls(e.target.files?.[0] ?? null)} />
        </label>
        <label>Stems (optional, 1–30 files)
          <input type="file" accept=".flac,.wav" multiple onChange={(e) => setStems(Array.from(e.target.files || []))} />
        </label>
        <label>Label
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="e.g. after mastering" />
        </label>
        <label>Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        {busy && <progress value={progress} max={1} />}
        {err && <p className="error">{err}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={!file || busy}>{busy ? 'Uploading…' : 'Add Version'}</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Build to confirm parses**

Run: `cd components/frontend-spectr && npm run build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/frontend-spectr/src/components/AddVersionModal.jsx
git commit -m "feat(frontend): AddVersionModal"
```

---

## Task 20: Frontend — SaveToLibraryModal

**Files:**
- Create: `components/frontend-spectr/src/components/SaveToLibraryModal.jsx`

- [ ] **Step 1: Create the component**

```jsx
import { useEffect, useState } from 'react';
import { listSongs } from '../api/songs.js';
import { saveToLibrary } from '../api/client.js';

export default function SaveToLibraryModal({ jobId, onCancel, onSaved }) {
  const [tab, setTab] = useState('new');  // 'new' | 'existing'
  const [name, setName] = useState('');
  const [songs, setSongs] = useState([]);
  const [songId, setSongId] = useState('');
  const [label, setLabel] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (tab === 'existing' && songs.length === 0) {
      listSongs().then(setSongs).catch(() => setSongs([]));
    }
  }, [tab, songs.length]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const body = tab === 'new'
      ? { action: 'new_song', name: name.trim(), label: label || undefined, notes: notes || undefined }
      : { action: 'add_to_song', song_id: songId, label: label || undefined, notes: notes || undefined };
    try {
      const r = await saveToLibrary(jobId, body);
      onSaved(r);
    } catch (e) {
      if (e.message?.includes('410')) setErr('This recording has expired — please re-upload to save it.');
      else if (e.message?.includes('409') && tab === 'new') setErr('You already have a song with that name.');
      else setErr(e.message || 'Save failed');
      setBusy(false);
    }
  }

  const canSubmit = tab === 'new' ? name.trim().length > 0 : songId.length > 0;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Save to Library</h2>
        <div className="tabs">
          <button type="button" className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}>New song</button>
          <button type="button" className={tab === 'existing' ? 'active' : ''} onClick={() => setTab('existing')}>Add to existing</button>
        </div>
        {tab === 'new' ? (
          <label>Song name
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
        ) : (
          <label>Choose song
            <select value={songId} onChange={(e) => setSongId(e.target.value)}>
              <option value="">— pick one —</option>
              {songs.map((s) => <option key={s.song_id} value={s.song_id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label>Version label (optional)
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
        </label>
        <label>Notes (optional)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        {err && <p className="error">{err}</p>}
        <div className="actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={!canSubmit || busy}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `cd components/frontend-spectr && npm run build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/frontend-spectr/src/components/SaveToLibraryModal.jsx
git commit -m "feat(frontend): SaveToLibraryModal — post-analysis CTA"
```

---

## Task 21: Frontend — SongCard + VersionRow

**Files:**
- Create: `components/frontend-spectr/src/components/SongCard.jsx`
- Create: `components/frontend-spectr/src/components/VersionRow.jsx`

- [ ] **Step 1: SongCard**

```jsx
const GRADE_COLOR = { A: '#34d399', B: '#00e5b0', C: '#fbbf24', D: '#fb923c', F: '#f43f5e' };
const gc = (g) => GRADE_COLOR[g?.[0]] ?? 'var(--muted)';

function fmt(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso.slice(0, 10); }
}

export default function SongCard({ song, onOpen }) {
  const col = gc(song.latest_grade);
  return (
    <button className="song-card" onClick={() => onOpen(song.song_id)}>
      <div className="grade-pill" style={{ background: `${col}18`, border: `1px solid ${col}44`, color: col }}>
        {song.latest_grade?.[0] ?? '·'}
      </div>
      <div className="meta">
        <div className="name">{song.name}</div>
        <div className="sub">
          {song.version_count} version{song.version_count !== 1 ? 's' : ''}
          {song.latest_score != null && ` · ${Math.round(song.latest_score)}/100`}
          {song.last_analyzed && ` · ${fmt(song.last_analyzed)}`}
        </div>
      </div>
    </button>
  );
}
```

- [ ] **Step 2: VersionRow**

```jsx
const GRADE_COLOR = { A: '#34d399', B: '#00e5b0', C: '#fbbf24', D: '#fb923c', F: '#f43f5e' };
const gc = (g) => GRADE_COLOR[g?.[0]] ?? 'var(--muted)';

function fmt(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return iso; }
}

export default function VersionRow({ version, onAnalyze, onView, onDelete, busy }) {
  const col = gc(version.latest_grade);
  return (
    <div className="version-row">
      <div className="vn">v{version.version_number}</div>
      <div className="meta">
        <div className="label">{version.label || '(unlabeled)'}</div>
        <div className="sub">
          {fmt(version.created_at)}
          {version.latest_score != null && ` · ${Math.round(version.latest_score)}/100`}
          {' · '}{version.analysis_count} analysis{version.analysis_count !== 1 ? 'es' : ''}
        </div>
      </div>
      <div className="grade" style={{ color: col }}>{version.latest_grade?.[0] ?? '—'}</div>
      <div className="actions">
        {version.latest_job_id && (
          <button onClick={() => onView(version.latest_job_id)}>View</button>
        )}
        <button onClick={() => onAnalyze(version.version_id)} disabled={busy}>
          {busy ? 'Starting…' : (version.latest_job_id ? '↺ Re-analyze' : 'Analyze')}
        </button>
        <button onClick={() => onDelete(version.version_id)} className="danger">Delete</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build**

Run: `cd components/frontend-spectr && npm run build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add components/frontend-spectr/src/components/SongCard.jsx components/frontend-spectr/src/components/VersionRow.jsx
git commit -m "feat(frontend): SongCard + VersionRow primitives"
```

---

## Task 22: Frontend — LibraryPage

**Files:**
- Create: `components/frontend-spectr/src/components/LibraryPage.jsx`

- [ ] **Step 1: Create the page**

```jsx
import { useEffect, useState } from 'react';
import { listSongs } from '../api/songs.js';
import SongCard from './SongCard.jsx';
import NewSongModal from './NewSongModal.jsx';

export default function LibraryPage({ onOpenSong, onBack, onLogout }) {
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      setSongs(await listSongs());
    } catch (e) {
      if (e.message?.includes('401')) onLogout?.();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  function handleCreated(song) {
    setShowNew(false);
    onOpenSong(song.song_id);
  }

  return (
    <div className="library-page">
      <div className="header">
        <button onClick={onBack}>← Back</button>
        <h1>Your Library</h1>
        <button className="primary" onClick={() => setShowNew(true)}>+ New Song</button>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : songs.length === 0 ? (
        <div className="empty">
          <p>No songs yet.</p>
          <button className="primary" onClick={() => setShowNew(true)}>+ Create your first song</button>
        </div>
      ) : (
        <div className="grid">
          {songs.map((s) => <SongCard key={s.song_id} song={s} onOpen={onOpenSong} />)}
        </div>
      )}

      {showNew && (
        <NewSongModal
          onCancel={() => setShowNew(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `cd components/frontend-spectr && npm run build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/frontend-spectr/src/components/LibraryPage.jsx
git commit -m "feat(frontend): LibraryPage"
```

---

## Task 23: Frontend — SongDetailPage

**Files:**
- Create: `components/frontend-spectr/src/components/SongDetailPage.jsx`

- [ ] **Step 1: Create the page**

```jsx
import { useEffect, useState } from 'react';
import { getSong, deleteSong } from '../api/songs.js';
import { analyzeVersion, deleteVersion } from '../api/versions.js';
import VersionRow from './VersionRow.jsx';
import AddVersionModal from './AddVersionModal.jsx';
import DeleteSongModal from './DeleteSongModal.jsx';

export default function SongDetailPage({ songId, onBack, onJobStarted, onViewResult, onLogout }) {
  const [song, setSong] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [busyVersion, setBusyVersion] = useState(null);

  async function reload() {
    setLoading(true); setErr(null);
    try {
      setSong(await getSong(songId));
    } catch (e) {
      if (e.message?.includes('401')) onLogout?.();
      else setErr(e.message || 'Failed to load song');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, [songId]);

  async function handleAnalyze(versionId) {
    setBusyVersion(versionId);
    try {
      const r = await analyzeVersion(versionId);
      onJobStarted(r.job_id);
    } catch (e) {
      if (e.message?.includes('409')) setErr('Analysis already running for this version.');
      else setErr(e.message || 'Analyze failed');
      setBusyVersion(null);
    }
  }

  async function handleDeleteVersion(versionId) {
    if (!confirm('Delete this version? This is permanent.')) return;
    try {
      await deleteVersion(versionId);
      await reload();
    } catch (e) {
      setErr(e.message || 'Delete failed');
    }
  }

  function handleVersionAdded() {
    setShowAdd(false);
    reload();
  }

  if (loading) return <div className="song-detail">Loading…</div>;
  if (!song) return <div className="song-detail">Not found</div>;

  return (
    <div className="song-detail">
      <div className="header">
        <button onClick={onBack}>← Library</button>
        <h1>{song.name}</h1>
        <button className="danger" onClick={() => setShowDelete(true)}>Delete</button>
      </div>

      {song.genre_hint && <p className="genre">Genre: {song.genre_hint}</p>}
      {err && <p className="error">{err}</p>}

      <div className="versions">
        <div className="versions-header">
          <h2>Versions ({song.version_count})</h2>
          <button className="primary" onClick={() => setShowAdd(true)}>+ Add Version</button>
        </div>
        {song.versions.length === 0 ? (
          <p>No versions yet. Click "+ Add Version" to upload one.</p>
        ) : (
          song.versions.map((v) => (
            <VersionRow
              key={v.version_id}
              version={v}
              busy={busyVersion === v.version_id}
              onAnalyze={handleAnalyze}
              onView={(jobId) => onViewResult(jobId, song.name)}
              onDelete={handleDeleteVersion}
            />
          ))
        )}
      </div>

      {showAdd && (
        <AddVersionModal
          song={song}
          onCancel={() => setShowAdd(false)}
          onAdded={handleVersionAdded}
        />
      )}
      {showDelete && (
        <DeleteSongModal
          song={song}
          onCancel={() => setShowDelete(false)}
          onDeleted={() => onBack()}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `cd components/frontend-spectr && npm run build 2>&1 | tail -10`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add components/frontend-spectr/src/components/SongDetailPage.jsx
git commit -m "feat(frontend): SongDetailPage with versions list + actions"
```

---

## Task 24: Wire up nav in App.jsx + ResultsPage CTA

**Files:**
- Modify: `components/frontend-spectr/src/App.jsx`
- Modify: `components/frontend-spectr/src/components/ResultsPage.jsx`
- Modify: `components/frontend-spectr/src/components/UploadPage.jsx`
- Delete: `components/frontend-spectr/src/components/SongLibrary.jsx`

- [ ] **Step 1: Read App.jsx to understand current state machine**

Run: open `components/frontend-spectr/src/App.jsx` and inspect — find where the current `state` enum lives. The new states needed are `library` and `song-detail`. Note where the existing `upload` → `processing` → `results` transitions live.

- [ ] **Step 2: Add LibraryPage + SongDetailPage to the state machine**

In `App.jsx`:
- Import `LibraryPage` and `SongDetailPage` at the top.
- Add to the page-switch: when state is `library` render `<LibraryPage onOpenSong={(id) => setPage({ name: 'song-detail', songId: id })} onBack={() => setPage('upload')} onLogout={onLogout} />`. Adjust to match the actual state idiom in the file.
- When state is `song-detail` render `<SongDetailPage songId={state.songId} onBack={() => setPage('library')} onJobStarted={(jobId) => setPage({ name: 'processing', jobId })} onViewResult={(jobId, name) => setPage({ name: 'results', jobId, name })} onLogout={onLogout} />`.
- Add a "Library" button to the top nav (wherever the existing logout/profile buttons live) that calls `setPage('library')`.

- [ ] **Step 3: Add SaveToLibraryModal trigger to ResultsPage**

In `ResultsPage.jsx`:
- Import `SaveToLibraryModal`.
- Add state: `const [showSave, setShowSave] = useState(false);`
- Add the CTA button somewhere visible near the top of the report:
```jsx
{!alreadyInLibrary && <button className="primary" onClick={() => setShowSave(true)}>Save to Library</button>}
```
- `alreadyInLibrary` is true when the job came from a song-detail view; the simplest signal is: if the page received `props.fromLibrary === true`, hide the CTA. Add `fromLibrary` to the props plumbing from App.jsx.
- Render the modal at the bottom of the component when `showSave`:
```jsx
{showSave && (
  <SaveToLibraryModal
    jobId={jobId}
    onCancel={() => setShowSave(false)}
    onSaved={(r) => { setShowSave(false); onSavedToLibrary?.(r.song_id); }}
  />
)}
```
- Plumb `onSavedToLibrary` through App.jsx: when called, navigate to `{ name: 'song-detail', songId }`.

- [ ] **Step 4: Remove the embedded SongLibrary panel from UploadPage**

Open `components/frontend-spectr/src/components/UploadPage.jsx`. Find any `import SongLibrary from './SongLibrary.jsx'` and the `<SongLibrary .../>` JSX usage. Remove both.

- [ ] **Step 5: Delete the SongLibrary file**

Run: `git rm components/frontend-spectr/src/components/SongLibrary.jsx`

- [ ] **Step 6: Build the frontend**

Run: `cd components/frontend-spectr && npm run build 2>&1 | tail -20`
Expected: build succeeds.

- [ ] **Step 7: Smoke-test manually**

Run: `cd components/frontend-spectr && npm run dev` and verify:
- Top-nav "Library" button visible after login.
- Clicking it navigates to library page (empty state).
- "+ New Song" creates a song; you land on song detail.
- "+ Add Version" on song detail uploads (with a real .wav); version appears.
- "Analyze" on version dispatches to ProcessingPage.
- Quick-analyze (from UploadPage) → Results → "Save to Library" → new song → lands on song detail.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(frontend): wire library + song-detail states, save-to-library CTA on ResultsPage"
```

---

## Task 25: Full validation gates

- [ ] **Step 1: Backend lint + type**

```
ruff check components/api/ components/shared/ components/worker/
mypy components/api/app/ --ignore-missing-imports
```
Expected: clean.

- [ ] **Step 2: All backend tests**

```
pip install -e components/shared
pytest -q components/api/tests/
pytest -q components/worker/tests/ 2>&1 | tail -20
pytest -q components/shared/tests/ 2>&1 | tail -20
```
Expected: all pass.

- [ ] **Step 3: Migration check**

```
alembic -c components/api/alembic.ini upgrade head
```
Expected: no-op (already at 010) or upgrade to 010.

- [ ] **Step 4: Frontend build**

```
cd components/frontend-spectr && npm run build
```
Expected: success.

- [ ] **Step 5: Commit a passing-gates marker (optional)**

```bash
git commit --allow-empty -m "chore: Plan A — Song Library Foundation complete, gates green"
```

---

## Self-review checklist

- [x] **Spec coverage:** Tasks cover §4 (data model — Task 1+2), §5.1 (songs CRUD — Tasks 5–7), §5.2 (versions — Tasks 8–10, 14), §5.3 (quick-analyze + save-to-library — Tasks 11–12), §7.2-§7.8 (frontend pages, modals, nav — Tasks 18–24), §8.1 + §8.2 (TTL/restore — Tasks 7, 15, 16), §8.3 (stem mapping reuse — Task 14), §8.4 (in-flight guard — Task 10), §8.5 (version_number conflict — Task 9). Spec §6 (delta engine) is explicitly deferred to Plan B. Spec §9.3 IDOR coverage is in Task 7 + Task 9.

- [x] **Placeholder scan:** No TBD/TODO. Every step has concrete code or commands.

- [x] **Type consistency:** `version_id` is used everywhere as the FK; `SongVersion.version_number` is the canonical (Int, user-editable, unique-per-song) field across model, schema, route, frontend. `Song.archived_at` for soft-delete is consistent across model, migration, routes, beat task. Beat-task function names match across `tasks_cleanup.py` and `celery_app.py` (`cleanup_orphan_uploads_task`, `purge_archived_songs_task`).

- [x] **Open items resolved during write:**
  - In Task 11 (save-to-library), the version's `version_number` is computed *after* loading the song, so the next-int logic handles "first save to existing song" (which sets `version_number=1`).
  - In Task 14, `proposed_mapping` is optional on `VersionDetail` — quietly null when no stems were uploaded.

---
