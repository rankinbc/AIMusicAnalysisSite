"""Tests that migration 010 correctly backfills SongVersion + UploadJob.version_id."""
from __future__ import annotations

import os
import subprocess
import sys
import uuid

import asyncpg
import pytest

DB_URL = os.environ.get(
    "TEST_DB_URL_PSYCOPG",
    "postgresql://postgres:postgres@localhost:5432/aimusic_test",
)

# components/api/ — alembic.ini lives here and script_location=alembic is relative to it.
API_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))


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
    # Use the asyncpg-style DB_URL directly; alembic + psycopg2 accept "postgresql://" too.
    env = os.environ.copy()
    env["ALEMBIC_DATABASE_URL"] = DB_URL
    # Invoke via sys.executable -m alembic so the test does not depend on a
    # bare `alembic` script being on PATH (it is not on Windows).
    subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", direction, target],
        check=True, env=env, cwd=API_DIR,
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
