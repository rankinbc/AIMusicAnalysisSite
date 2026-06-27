"""Teaching-unit selector (story: teach-mode-coach). Pure-function tests."""
from __future__ import annotations

from app.coach_lib.teach.models import TeachingUnit
from app.coach_lib.teach.selector import select_units


def _u(slug: str, category: str, aliases: list[str]) -> TeachingUnit:
    return TeachingUnit(
        slug=slug,
        category=category,
        aliases=tuple(aliases),
        reference_paths=("phase1.lufs",),
        title=slug,
        body="body",
    )


UNITS = [
    _u("low_mid_mud", "frequency_balance", ["mud", "muddy"]),
    _u("true_peak_ceiling", "clipping", ["true peak", "dbtp"]),
    _u("glue_compression", "dynamics", ["glue", "bus compression"]),
]


def test_keyword_hit_selects_unit():
    sel, catalog = select_units("why is my mix muddy?", [], UNITS)
    assert sel and sel[0].slug == "low_mid_mud"
    assert len(catalog) == 3  # catalog is ALWAYS the full list


def test_category_boost_surfaces_finding_relevant_unit():
    # No keyword match, but the track has a dynamics finding → glue unit surfaces.
    sel, _ = select_units("general advice please", [{"category": "dynamics"}], UNITS)
    assert [u.slug for u in sel] == ["glue_compression"]


def test_cap_enforced():
    many = [_u(f"u{i}", "dynamics", ["glue"]) for i in range(10)]
    sel, _ = select_units("glue", [], many, cap=3)
    assert len(sel) == 3


def test_no_match_returns_empty_with_full_catalog():
    sel, catalog = select_units("xyzzy nothing relevant", [], UNITS)
    assert sel == []
    assert len(catalog) == 3


def test_never_raises_on_junk_input():
    assert select_units("", None, UNITS)[0] == []
    # junk verdicts (None / no-category / non-dict) must not raise
    sel, _ = select_units("glue", [None, {"nope": 1}, "str"], UNITS)  # type: ignore[list-item]
    assert sel and sel[0].slug == "glue_compression"
