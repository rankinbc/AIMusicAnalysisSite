"""add share_token to analysis_results

Revision ID: 002
Revises: 001
Create Date: 2026-04-24

"""
from alembic import op
import sqlalchemy as sa

revision = '002'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('analysis_results', sa.Column('share_token', sa.String(36), nullable=True))
    # Backfill existing rows with unique tokens
    op.execute("UPDATE analysis_results SET share_token = gen_random_uuid()::text WHERE share_token IS NULL")
    op.alter_column('analysis_results', 'share_token', nullable=False)
    op.create_unique_constraint('uq_analysis_results_share_token', 'analysis_results', ['share_token'])
    op.create_index('ix_analysis_results_share_token', 'analysis_results', ['share_token'])


def downgrade() -> None:
    op.drop_index('ix_analysis_results_share_token', table_name='analysis_results')
    op.drop_constraint('uq_analysis_results_share_token', 'analysis_results', type_='unique')
    op.drop_column('analysis_results', 'share_token')
