"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-04-24

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '001'
down_revision = None
branch_labels = None
depends_on = None

# Use create_type=False everywhere — we create the enum with raw SQL first
_jobstatus = postgresql.ENUM(
    'PENDING', 'PROCESSING', 'COMPLETE', 'FAILED',
    name='jobstatus',
    create_type=False,
)


def upgrade() -> None:
    op.execute("CREATE TYPE jobstatus AS ENUM ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED')")

    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=True)

    op.create_table(
        'upload_jobs',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('status', _jobstatus, nullable=False, server_default='PENDING'),
        sa.Column('current_phase', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('phase_name', sa.String(100), nullable=False, server_default=''),
        sa.Column('phase_pct', sa.Float(), nullable=False, server_default='0.0'),
        sa.Column('file_path', sa.String(500), nullable=False),
        sa.Column('reference_path', sa.String(500), nullable=True),
        sa.Column('task_id', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_upload_jobs_user_id', 'upload_jobs', ['user_id'], unique=False)

    op.create_table(
        'analysis_results',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('job_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('phase_results', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('final_json', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['job_id'], ['upload_jobs.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('job_id'),
    )


def downgrade() -> None:
    op.drop_table('analysis_results')
    op.drop_index('ix_upload_jobs_user_id', table_name='upload_jobs')
    op.drop_table('upload_jobs')
    op.drop_index('ix_users_email', table_name='users')
    op.drop_table('users')
    op.execute("DROP TYPE IF EXISTS jobstatus")
