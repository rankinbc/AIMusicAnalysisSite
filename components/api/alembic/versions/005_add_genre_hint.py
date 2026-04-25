"""add genre_hint to upload_jobs

Revision ID: 005
Revises: 004
Create Date: 2026-04-25

"""
from alembic import op
import sqlalchemy as sa

revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('upload_jobs', sa.Column('genre_hint', sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column('upload_jobs', 'genre_hint')
