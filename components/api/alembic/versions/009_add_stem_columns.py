"""add stem_paths_raw, stem_paths, stem_metrics columns + AWAITING_STEM_MAPPING status

Revision ID: 009
Revises: 008
Create Date: 2026-04-26

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Postgres requires enum value adds outside of a transaction block.
    # The autocommit_block context handles this for us.
    with op.get_context().autocommit_block():
        op.execute(
            "ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS 'AWAITING_STEM_MAPPING'"
        )

    op.add_column(
        'upload_jobs',
        sa.Column('stem_paths_raw', JSONB, nullable=True),
    )
    op.add_column(
        'upload_jobs',
        sa.Column('stem_paths', JSONB, nullable=True),
    )
    op.add_column(
        'analysis_results',
        sa.Column('stem_metrics', JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column('analysis_results', 'stem_metrics')
    op.drop_column('upload_jobs', 'stem_paths')
    op.drop_column('upload_jobs', 'stem_paths_raw')
    # Note: PostgreSQL doesn't support removing enum values in a clean way.
    # The AWAITING_STEM_MAPPING value is left in place; downgrade only drops columns.
