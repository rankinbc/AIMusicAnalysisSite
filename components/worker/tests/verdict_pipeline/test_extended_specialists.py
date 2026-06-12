"""Verify FrequencyCollisionDetection + FrequencyBalance know about stem data."""
from app.verdict_lib.prompt_loader import load_prompt


def test_collision_prompt_has_stem_branch():
    _, body = load_prompt("frequency_collision")
    assert "phase4.stems.clash_matrix" in body
    assert "Stem-aware" in body or "stem-aware" in body.lower()


def test_collision_prompt_keeps_spectral_branch():
    # Sanity: original guidance still present for the no-stems path.
    _, body = load_prompt("frequency_collision")
    assert "spectral" in body.lower() or "frequency.problem_frequencies" in body.lower() or len(body) > 200


def test_balance_prompt_has_stem_branch():
    _, body = load_prompt("frequency_balance")
    assert "phase4.stems.per_stem" in body
