"""add track_name to upload_jobs

Revision ID: 003
Revises: 002
Create Date: 2026-04-24

"""
from alembic import op
import sqlalchemy as sa

revision = '003'
down_revision = '002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('upload_jobs', sa.Column('track_name', sa.String(200), nullable=True))
    op.create_index('ix_upload_jobs_track_name', 'upload_jobs', ['track_name'])


def downgrade() -> None:
    op.drop_index('ix_upload_jobs_track_name', table_name='upload_jobs')
    op.drop_column('upload_jobs', 'track_name')
