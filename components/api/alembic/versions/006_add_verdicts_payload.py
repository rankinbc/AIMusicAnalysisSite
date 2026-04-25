"""add verdicts_payload + verdict_validation_failures

Revision ID: 006
Revises: 005
Create Date: 2026-04-25

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = '006'
down_revision = '005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('analysis_results',
                  sa.Column('verdicts_payload', JSONB, nullable=True))
    op.add_column('analysis_results',
                  sa.Column('verdicts_generated_at', sa.DateTime(timezone=True),
                            nullable=True))
    op.add_column('analysis_results',
                  sa.Column('verdicts_prompt_version_set', sa.String(2000),
                            nullable=True))
    op.add_column('analysis_results',
                  sa.Column('verdicts_model', sa.String(50), nullable=True))
    op.create_index(
        'idx_analysis_results_verdicts_generated',
        'analysis_results',
        ['verdicts_generated_at'],
        postgresql_where=sa.text('verdicts_payload IS NOT NULL'),
    )

    op.create_table(
        'verdict_validation_failures',
        sa.Column('id', sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column('job_id', UUID(as_uuid=True),
                  sa.ForeignKey('upload_jobs.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('specialist', sa.String(64), nullable=False),
        sa.Column('prompt_version', sa.String(64), nullable=False),
        sa.Column('reason', sa.Text, nullable=False),
        sa.Column('raw_output_excerpt', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        'idx_verdict_failures_specialist',
        'verdict_validation_failures',
        ['specialist', sa.text('created_at DESC')],
    )


def downgrade() -> None:
    op.drop_index('idx_verdict_failures_specialist',
                  table_name='verdict_validation_failures')
    op.drop_table('verdict_validation_failures')
    op.drop_index('idx_analysis_results_verdicts_generated',
                  table_name='analysis_results')
    op.drop_column('analysis_results', 'verdicts_model')
    op.drop_column('analysis_results', 'verdicts_prompt_version_set')
    op.drop_column('analysis_results', 'verdicts_generated_at')
    op.drop_column('analysis_results', 'verdicts_payload')
