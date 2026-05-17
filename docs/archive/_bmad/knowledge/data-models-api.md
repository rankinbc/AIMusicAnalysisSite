# Data Models — components/api

Database: PostgreSQL 15. ORM: SQLAlchemy 2.0 async.

## Tables

### `users`
| Column | Type | Nullable | Unique | Default | Notes |
|--------|------|----------|--------|---------|-------|
| id | UUID (PK) | No | — | uuid4() | Primary key |
| email | String(255) | No | Yes | — | Indexed |
| hashed_password | String(255) | No | — | — | bcrypt hash |
| is_active | Boolean | No | — | True | Soft-delete flag |
| created_at | DateTime(tz) | No | — | func.now() | UTC server default |

**Relationships:** `jobs → UploadJob[]` (lazy=noload)

---

### `upload_jobs`
| Column | Type | Nullable | Unique | Default | Notes |
|--------|------|----------|--------|---------|-------|
| id | UUID (PK) | No | — | uuid4() | Primary key |
| user_id | UUID (FK→users) | No | — | — | Indexed |
| status | Enum | No | — | PENDING | PENDING/PROCESSING/COMPLETE/FAILED |
| current_phase | Integer | No | — | 0 | Phase 0–7 |
| phase_name | String(100) | No | — | "" | Human-readable phase name |
| phase_pct | Float | No | — | 0.0 | Progress 0.0–1.0 |
| file_path | String(500) | No | — | — | Path to uploaded audio |
| reference_path | String(500) | Yes | — | None | Optional reference track path |
| task_id | String(255) | Yes | — | None | Celery task ID |
| track_name | String(200) | Yes | — | None | Indexed. User-provided for version grouping |
| created_at | DateTime(tz) | No | — | func.now() | UTC |
| started_at | DateTime(tz) | Yes | — | None | Set when PROCESSING begins |
| completed_at | DateTime(tz) | Yes | — | None | Set when COMPLETE/FAILED |

**Relationships:** `user → User` (lazy=noload), `result → AnalysisResult` (lazy=noload)

**Migrations:** 001 (initial), 003 (track_name added)

---

### `analysis_results`
| Column | Type | Nullable | Unique | Default | Notes |
|--------|------|----------|--------|---------|-------|
| id | UUID (PK) | No | — | uuid4() | Primary key |
| job_id | UUID (FK→upload_jobs) | No | Yes | — | One-to-one with job |
| phase_results | JSONB | No | — | [] | Array of per-phase outputs |
| final_json | JSONB | No | — | {} | Full PipelineResult dict |
| share_token | String(36) | No | Yes | uuid4() | Indexed. Public share link token |
| created_at | DateTime(tz) | No | — | func.now() | UTC |

**Relationships:** `job → UploadJob` (lazy=noload)

**Migrations:** 001 (initial), 002 (share_token added)

---

## `JobStatus` Enum

```python
class JobStatus(str, enum.Enum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"
```

---

## Migrations

| File | Revision | Description |
|------|----------|-------------|
| `001_initial_schema.py` | 001 | Creates jobstatus enum, users, upload_jobs, analysis_results tables |
| `002_add_share_token.py` | 002 | Adds share_token to analysis_results; backfills with gen_random_uuid(); adds unique constraint + index |
| `003_add_track_name.py` | 003 | Adds track_name (nullable String(200)) to upload_jobs; adds index |

Current head: `003`

Run migrations: `cd components/api && alembic upgrade head`

---

## Connection Configuration

```
# App (FastAPI async runtime)
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/music_analyzer

# Alembic migrations (sync runner — asyncpg fails here)
ALEMBIC_DATABASE_URL=postgresql+psycopg2://postgres:postgres@localhost:5432/music_analyzer
```

**Critical:** `async_sessionmaker(expire_on_commit=False)` — required to prevent `MissingGreenlet` errors when accessing ORM attributes after `session.commit()` in async context.
