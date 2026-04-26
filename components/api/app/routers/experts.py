"""Stub: legacy experts router replaced by verdict_pipeline (v1.2 cutover).

Kept as an empty router because some external tool keeps re-adding the
`from .routers import experts` import to main.py. Empty stub so the import
always succeeds without exposing any endpoints.
"""
from fastapi import APIRouter

router = APIRouter()
