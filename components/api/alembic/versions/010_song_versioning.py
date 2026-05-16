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
