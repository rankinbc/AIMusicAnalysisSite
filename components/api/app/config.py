from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/music_analyzer"
    ALEMBIC_DATABASE_URL: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/music_analyzer"
    REDIS_URL: str = "redis://localhost:6379/0"

    JWT_SECRET: str = "change-me-in-production"
    JWT_ACCESS_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_EXPIRE_DAYS: int = 30

    CORS_ALLOW_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
        "http://localhost:5177",
        "http://localhost:5178",
        "http://localhost:5179",
        "http://localhost:5180",
    ]

    UPLOAD_DIR: Path = Path("../../data/uploads")
    RESULTS_DIR: Path = Path("../../output/analysis_results")
    MAX_UPLOAD_BYTES: int = 200 * 1024 * 1024

    STORAGE_BACKEND: str = "local"

    anthropic_api_key: str = ""          # set via ANTHROPIC_API_KEY env var
    output_dir: str = "output"           # relative to project root; override via OUTPUT_DIR
    use_claude_cli: bool = False         # set USE_CLAUDE_CLI=true in dev to use subscription instead of API key


settings = Settings()
