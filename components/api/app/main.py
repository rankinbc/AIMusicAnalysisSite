from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .routers import auth as auth_router
from .routers import experts as experts_router
from .routers import jobs as jobs_router
from .routers import uploads as uploads_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: nothing heavyweight needed here — DB pool warms on first request.
    yield
    # Shutdown: SQLAlchemy async engine disposes connections gracefully.
    from .db import engine
    await engine.dispose()


app = FastAPI(
    title="AI Music Analyzer API",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — explicit origins required when allow_credentials=True; never "*".
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix="/auth", tags=["auth"])
app.include_router(uploads_router.router, prefix="/uploads", tags=["uploads"])
app.include_router(jobs_router.router, prefix="/jobs", tags=["jobs"])
app.include_router(experts_router.router, tags=["experts"])


@app.get("/", tags=["health"])
async def root() -> dict:
    return {"status": "ok", "version": "1.0.0"}
