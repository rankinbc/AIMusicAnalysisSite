"""add songs table and song_id to upload_jobs

Revision ID: 008
Revises: 007
Create Date: 2026-04-26

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '008'
down_revision = '007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'songs',
        sa.Column('id', UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('user_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('file_path', sa.String(500), nullable=False),
        sa.Column('reference_path', sa.String(500), nullable=True),
        sa.Column('als_file_path', sa.String(500), nullable=True),
        sa.Column('genre_hint', sa.String(50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint('user_id', 'name', name='uq_songs_user_name'),
    )
    op.create_index('idx_songs_user_id', 'songs', ['user_id'])

    op.add_column(
        'upload_jobs',
        sa.Column('song_id', UUID(as_uuid=True),
                  sa.ForeignKey('songs.id', ondelete='SET NULL'), nullable=True),
    )
    op.create_index('idx_upload_jobs_song_id', 'upload_jobs', ['song_id'])


def downgrade() -> None:
    op.drop_index('idx_upload_jobs_song_id', table_name='upload_jobs')
    op.drop_column('upload_jobs', 'song_id')
    op.drop_index('idx_songs_user_id', table_name='songs')
    op.drop_table('songs')
