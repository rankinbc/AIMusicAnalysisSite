# migrations

Alembic database schema migrations. Shared across all components that touch PostgreSQL (api, worker).

Run migrations: `alembic -c migrations/alembic.ini upgrade head`
Create a new migration: `alembic -c migrations/alembic.ini revision --autogenerate -m "description"`
