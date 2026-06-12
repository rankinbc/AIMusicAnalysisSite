"""Verify the three new stem specialist prompts load and contain key fields."""
from app.verdict_lib.prompt_loader import SLUG_TO_FILENAME, load_prompt


def test_stem_specialist_slugs_registered():
    for slug in ("stem_balance", "stem_stereo_width", "stem_reference_delta"):
        assert slug in SLUG_TO_FILENAME


def test_stem_balance_prompt_loads_and_gates():
    version, body = load_prompt("stem_balance")
    assert version == "1.0.0"
    assert "phase4.stems.balance_flags" in body
    assert "phase4.stems.status" in body


def test_stem_stereo_width_prompt_loads_and_gates():
    version, body = load_prompt("stem_stereo_width")
    assert version == "1.0.0"
    assert "phase4.stems.per_stem" in body
    assert "stereo_width" in body


def test_stem_reference_delta_prompt_loads_and_gates():
    version, body = load_prompt("stem_reference_delta")
    assert version == "1.0.0"
    assert "phase5.per_stem_reference_deltas" in body
    assert "stem_reference_comparison" in body


def test_triage_lists_new_slugs():
    from app.verdict_lib.prompt_loader import load_triage
    _, body = load_triage()
    for slug in ("stem_balance", "stem_stereo_width", "stem_reference_delta"):
        assert slug in body, f"Triage prompt missing slug: {slug}"
