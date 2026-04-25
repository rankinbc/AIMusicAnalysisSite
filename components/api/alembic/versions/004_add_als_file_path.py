"""add als_file_path to upload_jobs

Revision ID: 004
Revises: 003
Create Date: 2026-04-25

"""
from alembic import op
import sqlalchemy as sa

revision = '004'
down_revision = '003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('upload_jobs', sa.Column('als_file_path', sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column('upload_jobs', 'als_file_path')
