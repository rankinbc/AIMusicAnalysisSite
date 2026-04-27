from __future__ import annotations
import sys
import uuid
import pathlib
import xml.etree.ElementTree as ET

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from aimusic_shared.models import UploadJob, User
from app.db import get_session
from app.routers.auth import get_current_user

# Make the analysis package importable
_ANALYSIS_SRC = pathlib.Path(__file__).parents[4] / "analysis" / "src"
if str(_ANALYSIS_SRC) not in sys.path:
    sys.path.insert(0, str(_ANALYSIS_SRC))

router = APIRouter(tags=["als-project"])

_TAG_TO_TYPE = {
    "MidiTrack": "midi",
    "AudioTrack": "audio",
    "ReturnTrack": "return",
    "GroupTrack": "group",
}


@router.get("/reports/{job_id}/als-project")
async def get_als_project(
    job_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_session),
):
    job = (await db.execute(
        select(UploadJob)
        .where(UploadJob.id == job_id)
        .where(UploadJob.user_id == user.id)
    )).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if not job.als_file_path:
        raise HTTPException(status_code=404, detail="no .als file for this job")

    try:
        return _parse_als_project(job.als_file_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=".als file missing from storage")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"failed to parse .als: {exc}") from exc


def _parse_als_project(als_path: str) -> dict:
    from audio_analysis.als.als_parser import ALSParser

    parser = ALSParser()
    project = parser.parse(als_path)
    root: ET.Element = parser._root

    # Build a lookup: (track_type_tag, track_name) → XML element
    # Use the same priority as _get_track_name: EffectiveName first, UserName as fallback.
    elem_map: dict[tuple[str, str], ET.Element] = {}
    for xml_tag in _TAG_TO_TYPE:
        for elem in root.findall(f".//{xml_tag}"):
            eff = elem.find(".//Name/EffectiveName")
            name = eff.attrib.get("Value", "") if eff is not None else ""
            if not name:
                usr = elem.find(".//Name/UserName")
                name = usr.attrib.get("Value", "") if usr is not None else ""
            elem_map[(xml_tag, name)] = elem

    # Build per-track XML-tag mapping from track type
    type_to_xml_tag = {v: k for k, v in _TAG_TO_TYPE.items()}

    tracks = []
    for track in project.tracks:
        xml_tag = type_to_xml_tag.get(track.track_type)
        track_elem = elem_map.get((xml_tag, track.name)) if xml_tag else None
        devices = parser._get_track_devices_detailed(track_elem) if track_elem is not None else []

        tracks.append({
            "name": track.name,
            "type": track.track_type,
            "color": track.color,
            "muted": track.is_muted,
            "solo": track.is_solo,
            "volume_db": round(track.volume_db, 2),
            "pan": round(track.pan, 3),
            "clip_count": len(track.midi_clips) + len(track.audio_clips),
            "devices": devices,
        })

    return {
        "tempo": project.tempo,
        "time_signature": (
            f"{project.time_signature_numerator}/{project.time_signature_denominator}"
        ),
        "ableton_version": project.ableton_version,
        "track_count": len(tracks),
        "tracks": tracks,
    }
