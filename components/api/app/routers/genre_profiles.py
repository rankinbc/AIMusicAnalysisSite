"""Genre profiles router — serves statistical genre profile data."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# Project root is four levels above this file:
#   genre_profiles.py → routers/ → app/ → api/ → components/ → project root
_PROFILES_DIR = Path(__file__).parents[4] / "data" / "reference_library" / "profiles"

_GENRE_FILENAMES: dict[str, str] = {
    "trance": "trance_profile.json",
    "house": "house_profile.json",
    "techno": "techno_profile.json",
    "dnb": "dnb_profile.json",
    "progressive": "progressive_profile.json",
}

_GENRE_DISPLAY: dict[str, str] = {
    "trance": "Trance",
    "house": "House",
    "techno": "Techno",
    "dnb": "Drum & Bass",
    "progressive": "Progressive",
}

_PRESETS: dict[str, dict] = {
    "trance": {
        "target_lufs": -14.0,
        "bpm_min": 136,
        "bpm_max": 145,
        "correlation_min": 0.3,
        "correlation_max": 0.6,
        "bass_mono_below_hz": 150,
    },
    "house": {
        "target_lufs": -14.0,
        "bpm_min": 120,
        "bpm_max": 128,
        "correlation_min": 0.35,
        "correlation_max": 0.65,
        "bass_mono_below_hz": 120,
    },
    "techno": {
        "target_lufs": -14.0,
        "bpm_min": 128,
        "bpm_max": 140,
        "correlation_min": 0.4,
        "correlation_max": 0.7,
        "bass_mono_below_hz": 100,
    },
    "dnb": {
        "target_lufs": -14.0,
        "bpm_min": 170,
        "bpm_max": 180,
        "correlation_min": 0.25,
        "correlation_max": 0.55,
        "bass_mono_below_hz": 150,
    },
    "progressive": {
        "target_lufs": -14.0,
        "bpm_min": 122,
        "bpm_max": 132,
        "correlation_min": 0.3,
        "correlation_max": 0.55,
        "bass_mono_below_hz": 140,
    },
}


class GenreProfileSummary(BaseModel):
    genre: str
    display_name: str
    profile_name: str | None
    track_count: int
    created_date: str | None
    has_profile: bool


class FeatureStats(BaseModel):
    mean: float
    std: float
    min: float
    max: float
    p10: float
    p25: float
    p50: float
    p75: float
    p90: float
    acceptable_range: list[float]


class GenrePreset(BaseModel):
    target_lufs: float
    bpm_min: int
    bpm_max: int
    correlation_min: float
    correlation_max: float
    bass_mono_below_hz: int


class GenreProfileDetail(BaseModel):
    genre: str
    display_name: str
    profile_name: str
    track_count: int
    created_date: str
    feature_statistics: dict[str, FeatureStats]
    preset: GenrePreset | None


def _load_profile(genre: str) -> dict[str, Any] | None:
    filename = _GENRE_FILENAMES.get(genre)
    if not filename:
        return None
    path = _PROFILES_DIR / filename
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


@router.get("", response_model=list[GenreProfileSummary])
async def list_genre_profiles() -> list[GenreProfileSummary]:
    """List all genres with availability of their statistical profiles."""
    summaries = []
    for genre in _GENRE_DISPLAY:
        data = _load_profile(genre)
        summaries.append(
            GenreProfileSummary(
                genre=genre,
                display_name=_GENRE_DISPLAY[genre],
                profile_name=data.get("name") if data else None,
                track_count=data.get("track_count", 0) if data else 0,
                created_date=data.get("created_date") if data else None,
                has_profile=data is not None,
            )
        )
    return summaries


@router.get("/{genre}", response_model=GenreProfileDetail)
async def get_genre_profile(genre: str) -> GenreProfileDetail:
    """Return the full statistical profile for a genre."""
    genre = genre.lower().strip()
    if genre not in _GENRE_DISPLAY:
        raise HTTPException(status_code=404, detail=f"Unknown genre: {genre}")

    data = _load_profile(genre)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"No statistical profile available for {_GENRE_DISPLAY[genre]} yet.",
        )

    raw_stats: dict[str, Any] = data.get("feature_statistics", {})
    feature_statistics: dict[str, FeatureStats] = {}
    for feat, s in raw_stats.items():
        try:
            feature_statistics[feat] = FeatureStats(
                mean=s["mean"],
                std=s["std"],
                min=s["min"],
                max=s["max"],
                p10=s["p10"],
                p25=s["p25"],
                p50=s["p50"],
                p75=s["p75"],
                p90=s["p90"],
                acceptable_range=s["acceptable_range"],
            )
        except (KeyError, TypeError):
            continue

    preset_data = _PRESETS.get(genre)
    preset = GenrePreset(**preset_data) if preset_data else None

    return GenreProfileDetail(
        genre=genre,
        display_name=_GENRE_DISPLAY[genre],
        profile_name=data.get("name", ""),
        track_count=data.get("track_count", 0),
        created_date=data.get("created_date", ""),
        feature_statistics=feature_statistics,
        preset=preset,
    )
