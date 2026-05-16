from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

pytest_plugins = ("anyio",)


@compiles(JSONB, "sqlite")
def _compile_jsonb_for_sqlite(element, compiler, **kw):
    """Render Postgres JSONB as SQLite JSON so `Base.metadata.create_all`
    works against in-memory sqlite test DBs. Affects test runs only."""
    return "JSON"
