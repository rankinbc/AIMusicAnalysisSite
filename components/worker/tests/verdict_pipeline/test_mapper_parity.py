"""Results v4 Task 1.7: field-parity guard for the two hand-maintained
pydantic→ORM verdict mappers.

``verdict_actor._persist_verdict`` and ``degraded._to_row`` are structurally
identical by convention only — historically a column added to one and not the
other passed CI silently (only ``_to_row`` had coverage). This test builds ONE
fully-populated pydantic Verdict (non-default value for every mapped field),
runs it through BOTH mappers, and asserts every ``verdicts`` column lands with
the same value. Any future column mapped by one but not the other fails here.
"""
from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest
from sqlalchemy import inspect as sa_inspect

from aimusic_shared.verdicts.models import DspOp, Evidence, Fix, Verdict as VerdictModel


def _full_verdict() -> VerdictModel:
    """Every mapped field set to a NON-DEFAULT value, so an unmapped column
    shows up as (default vs value) instead of (default vs default)."""
    return VerdictModel(
        verdict_id="vrd_01parity0000000000000000",
        track_id="trk_parity",
        specialist="low_end",
        prompt_version="low_end@2.0.0",
        model="claude-cli",
        severity="severe",
        category="low_end",
        confidence=0.87,
        priority_score=109,
        headline="Sub band is smearing the kick",
        summary="The 40-60 Hz band overlaps between kick and bass.",
        evidence=[
            Evidence(
                metric="phase4.band_energy.sub_bass",
                value=-9.1,
                expected_range=(-16.0, -12.0),
                delta_pct=22.5,
                label="-9.1 dB sub energy",
                frequency_range_hz=(40.0, 60.0),
                stems=["kick", "bass"],
            )
        ],
        fix=Fix(
            fix_id="fix_01parity000000000000000",
            target={"type": "stem", "name": "bass"},
            section={"start_seconds": 10.0, "end_seconds": 40.0},
            dsp_chain=[DspOp(type="high_pass", params={"frequency_hz": 35.0, "slope_db": 24.0})],
            sidechain={"source_stem": "kick", "depth_db": 4.0},
            expected_outcome="Kick punches through below 60 Hz.",
            ableton_hint={"device": "EQ Eight"},
        ),
        why_it_matters="Low-end mud costs translation on small speakers.",
        related_verdict_ids=["vrd_01parityrelated000000000"],
        sources=["phase4.band_energy"],
        created_at=datetime(2026, 7, 26, tzinfo=timezone.utc),
        problem_id="low_end.sub_overlap.0",
        kind="observation",
        source="llm_identifier",
        data_tier="stems",
        fixable=False,
        suspected=True,
        where={"section_type": "drop", "start_seconds": 10.0, "end_seconds": 40.0},
        refines="low_end.mud.0",
        priority_base=120,
        priority_category_weight=1.3,
        priority_scope_multiplier=0.7,
        scope="single_section",
    )


@pytest.fixture
def captured_rows(monkeypatch, tmp_path):
    """Run the same verdict through both mappers; return (actor_row, degraded_row)."""
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'parity.db'}")
    from app import verdict_actor
    from app.verdict_lib import degraded

    added: list = []

    class _Session:
        def add(self, row):
            added.append(row)

    @contextmanager
    def _begin():
        yield _Session()

    class _Factory:
        @staticmethod
        def begin():
            return _begin()

    monkeypatch.setattr(verdict_actor, "SessionFactory", _Factory())

    aid = uuid.uuid4()
    v = _full_verdict()
    verdict_actor._persist_verdict(aid, v)
    actor_row = added[0]
    degraded_row = degraded._to_row(aid, v)
    return actor_row, degraded_row


def test_both_mappers_set_identical_columns(captured_rows):
    from aimusic_shared.models import Verdict as VerdictRow

    actor_row, degraded_row = captured_rows
    for attr in (a.key for a in sa_inspect(VerdictRow).column_attrs):
        if attr == "created_at":
            continue  # both stamp datetime.now() at call time
        assert getattr(actor_row, attr) == getattr(degraded_row, attr), (
            f"mapper drift on verdicts.{attr}: "
            f"_persist_verdict={getattr(actor_row, attr)!r} vs _to_row={getattr(degraded_row, attr)!r}"
        )


def test_mappers_carry_priority_breakdown(captured_rows):
    """The four results-v4 breakdown columns must survive both mappers."""
    for row in captured_rows:
        assert row.priority_base == 120
        assert row.priority_category_weight == 1.3
        assert row.priority_scope_multiplier == 0.7
        assert row.scope == "single_section"
