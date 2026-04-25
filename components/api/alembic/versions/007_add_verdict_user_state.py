"""add verdict_user_state table

Revision ID: 007
Revises: 006
Create Date: 2026-04-25

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = '007'
down_revision = '006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'verdict_user_state',
        sa.Column('verdict_id', sa.String(40), nullable=False),
        sa.Column('user_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('job_id', UUID(as_uuid=True),
                  sa.ForeignKey('upload_jobs.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('dismissed', sa.Boolean, nullable=False,
                  server_default=sa.text('false')),
        sa.Column('applied', sa.Boolean, nullable=False,
                  server_default=sa.text('false')),
        sa.Column('user_modified_fix', JSONB, nullable=True),
        sa.Column('feedback', sa.String(20), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('verdict_id', 'user_id'),
        sa.CheckConstraint(
            "feedback IN ('helpful', 'wrong', 'unclear') OR feedback IS NULL",
            name='verdict_user_state_feedback_chk',
        ),
    )
    op.create_index(
        'idx_verdict_user_state_user_job',
        'verdict_user_state',
        ['user_id', 'job_id'],
    )


def downgrade() -> None:
    op.drop_index('idx_verdict_user_state_user_job',
                  table_name='verdict_user_state')
    op.drop_table('verdict_user_state')
