"""The worker writes system-generated rack presets (source='analysis'); it needs
an ORM mirror of the EF `rack_presets` table to do so.
"""
from __future__ import annotations

from aimusic_shared.models import RackPreset


def test_rack_preset_tablename_and_columns():
    assert RackPreset.__tablename__ == "rack_presets"
    cols = set(RackPreset.__table__.columns.keys())
    assert {"id", "song_version_id", "name", "source",
            "chain_json", "created_at", "updated_at"} <= cols


def test_rack_preset_source_default():
    c = RackPreset.__table__.c
    assert c.source.default is not None or c.source.server_default is not None
