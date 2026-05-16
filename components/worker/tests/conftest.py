from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles


@compiles(JSONB, "sqlite")
def _compile_jsonb_for_sqlite(element, compiler, **kw):
    """Render Postgres JSONB as SQLite JSON so Base.metadata.create_all
    works against in-memory sqlite test DBs."""
    return "JSON"
