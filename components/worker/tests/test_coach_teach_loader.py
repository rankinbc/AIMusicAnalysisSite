"""Teaching-unit loader validation (story: teach-mode-coach)."""
from __future__ import annotations

import pytest

from app.coach_lib.teach.loader import (
    KNOWN_CATEGORIES,
    TeachingUnitError,
    load_units,
    parse_unit,
)

VALID = """---
slug: test_unit
category: low_end
aliases: [boom, boomy]
reference_paths: [phase1.bands.bass, phase1.low_energy]
title: Test unit
---
## Explain
Body text here.
"""


def test_parse_valid_unit():
    u = parse_unit(VALID)
    assert u.slug == "test_unit"
    assert u.category == "low_end"
    assert u.aliases == ("boom", "boomy")
    assert u.reference_paths == ("phase1.bands.bass", "phase1.low_energy")
    assert u.title == "Test unit"
    assert "Body text here." in u.body


def test_title_defaults_from_slug_when_absent():
    text = VALID.replace("title: Test unit\n", "")
    u = parse_unit(text)
    assert u.title == "test unit"


def test_missing_frontmatter_raises():
    with pytest.raises(TeachingUnitError):
        parse_unit("just some text, no frontmatter")


def test_missing_required_key_raises():
    text = VALID.replace("category: low_end\n", "")
    with pytest.raises(TeachingUnitError):
        parse_unit(text)


def test_unknown_category_raises():
    text = VALID.replace("category: low_end", "category: not_a_real_category")
    with pytest.raises(TeachingUnitError):
        parse_unit(text)


def test_invalid_reference_path_raises():
    text = VALID.replace("phase1.bands.bass", "phase1..bad path!")
    with pytest.raises(TeachingUnitError):
        parse_unit(text)


def test_empty_reference_paths_raises():
    text = VALID.replace("[phase1.bands.bass, phase1.low_energy]", "[]")
    with pytest.raises(TeachingUnitError):
        parse_unit(text)


def test_empty_body_raises():
    text = (
        "---\n"
        "slug: x\n"
        "category: low_end\n"
        "aliases: [a]\n"
        "reference_paths: [phase1.lufs]\n"
        "---\n"
    )
    with pytest.raises(TeachingUnitError):
        parse_unit(text)


# ── the shipped seed pack must load cleanly ─────────────────────────────────

def test_seed_pack_loads_and_validates():
    units = load_units(force=True)
    assert len(units) >= 12
    slugs = {u.slug for u in units}
    # spot-check coverage across the slice domains
    assert {"low_mid_mud", "over_compression", "true_peak_ceiling"} <= slugs
    for u in units:
        assert u.category in KNOWN_CATEGORIES
        assert u.reference_paths  # non-empty
        assert u.body.strip()
