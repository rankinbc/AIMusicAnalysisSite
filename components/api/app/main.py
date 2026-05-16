import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .routers import auth as auth_router
from .routers import experts as experts_router
from .routers import genre_profiles as genre_profiles_router
from .routers import jobs as jobs_router
from .routers import reports as reports_router
from .routers import songs as songs_router
from .routers import uploads as uploads_router
from .routers import als_project as als_project_router
from .routers import stems as stems_router
from .routers import verdicts as verdicts_router


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
app.include_router(reports_router.router, prefix="/reports", tags=["reports"])
app.include_router(songs_router.router)
app.include_router(experts_router.router, tags=["experts"])
app.include_router(genre_profiles_router.router, prefix="/genre-profiles", tags=["genre-profiles"])
app.include_router(als_project_router.router)
app.include_router(stems_router.router)
app.include_router(verdicts_router.router)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc), "traceback": traceback.format_exc()},
    )


@app.get("/", tags=["health"])
async def root() -> dict:
    return {"status": "ok", "version": "1.0.0"}
