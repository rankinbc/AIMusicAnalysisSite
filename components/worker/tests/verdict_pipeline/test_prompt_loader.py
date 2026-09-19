from __future__ import annotations
from pathlib import Path
import pytest
from app.verdict_lib.prompt_loader import (
    SLUG_TO_FILENAME,
    SPECIALIST_SLUGS,
    load_coach_concise_style,
    load_coach_grounded,
    load_coach_grounded_model,
    load_prompt,
    parse_version_frontmatter,
)


def test_slug_mapping_complete():
    assert "low_end" in SLUG_TO_FILENAME
    assert SLUG_TO_FILENAME["low_end"] == "LowEnd"
    assert SLUG_TO_FILENAME["frequency_balance"] == "FrequencyBalance"
    assert SLUG_TO_FILENAME["priority_summary"] == "PriorityProblemSummary"
    # Triage is not a "specialist" run by the runner — separate mapping
    assert "triage" not in SLUG_TO_FILENAME


def test_all_26_specialist_slugs_present():
    # 23 originals + 3 stem specialists (stem_balance, stem_stereo_width,
    # stem_reference_delta). The count must match SpecialistCatalog.cs.
    # The coach-mix arbiter prompt lives in ARBITER_SLUG_TO_FILENAME,
    # deliberately outside this catalog set.
    assert len(SPECIALIST_SLUGS) == 26
    assert "mastering_engineer" not in SPECIALIST_SLUGS


def test_parse_version_frontmatter_present():
    body = (
        "---\nversion: 1.2.0\n---\n\n# Title\n\nbody"
    )
    version, content = parse_version_frontmatter(body)
    assert version == "1.2.0"
    assert content.lstrip().startswith("# Title")


def test_parse_version_frontmatter_missing_defaults():
    body = "# Title\n\nbody"
    version, content = parse_version_frontmatter(body)
    assert version == "0.0.0"
    assert content == body


def test_load_prompt_real_file(tmp_path: Path, monkeypatch):
    fake_dir = tmp_path / "experts"
    fake_dir.mkdir()
    (fake_dir / "LowEnd.md").write_text("---\nversion: 2.0.1\n---\n# LowEnd\nbody")
    monkeypatch.setattr("app.verdict_lib.prompt_loader.PROMPTS_DIR", fake_dir)
    version, content = load_prompt("low_end")
    assert version == "2.0.1"
    assert "# LowEnd" in content


def test_load_unknown_slug_raises(monkeypatch, tmp_path):
    monkeypatch.setattr("app.verdict_lib.prompt_loader.PROMPTS_DIR", tmp_path)
    with pytest.raises(KeyError):
        load_prompt("nonexistent_slug")


# ── coach prompt loader (story 1.5) ────────────────────────────────────────

def test_load_coach_grounded_real_file(tmp_path: Path, monkeypatch):
    fake_dir = tmp_path / "coach"
    fake_dir.mkdir()
    (fake_dir / "CoachGrounded.md").write_text(
        "---\nversion: 3.4.5\nmodel: claude-opus-4-7\n---\n\nbody here",
    )
    monkeypatch.setattr(
        "app.verdict_lib.prompt_loader.COACH_PROMPTS_DIR", fake_dir,
    )
    version, body = load_coach_grounded()
    assert version == "3.4.5"
    assert "body here" in body
    assert load_coach_grounded_model() == "claude-opus-4-7"


def test_load_coach_grounded_missing_file_raises(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "app.verdict_lib.prompt_loader.COACH_PROMPTS_DIR", tmp_path,
    )
    with pytest.raises(FileNotFoundError):
        load_coach_grounded()


def test_load_coach_grounded_model_no_pin_returns_none(tmp_path: Path, monkeypatch):
    fake_dir = tmp_path / "coach"
    fake_dir.mkdir()
    (fake_dir / "CoachGrounded.md").write_text(
        "---\nversion: 1.0.0\n---\n\nbody",
    )
    monkeypatch.setattr(
        "app.verdict_lib.prompt_loader.COACH_PROMPTS_DIR", fake_dir,
    )
    assert load_coach_grounded_model() is None


# ── concise-mode style overlay (adhoc2, 2026-09-19) ────────────────────────

def test_load_coach_concise_style_real_file(tmp_path: Path, monkeypatch):
    fake_dir = tmp_path / "coach"
    fake_dir.mkdir()
    (fake_dir / "ConciseStyle.md").write_text(
        "---\nversion: 9.9.9\n---\n\n35-word overlay body here",
    )
    monkeypatch.setattr(
        "app.verdict_lib.prompt_loader.COACH_PROMPTS_DIR", fake_dir,
    )
    version, body = load_coach_concise_style()
    assert version == "9.9.9"
    assert "35-word overlay body here" in body


def test_load_coach_concise_style_missing_file_raises(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(
        "app.verdict_lib.prompt_loader.COACH_PROMPTS_DIR", tmp_path,
    )
    with pytest.raises(FileNotFoundError):
        load_coach_concise_style()


def test_live_coach_concise_style_loads():
    """The on-disk ConciseStyle.md must parse and state the 35-word rule —
    guards against a frontmatter/content typo slipping into production."""
    version, body = load_coach_concise_style()
    assert version == "1.0.0"
    assert "35 word" in body or "35-word" in body or "~35 words" in body
    assert "<<<EVIDENCE>>>" in body


def test_live_coach_prompt_loads():
    """The on-disk CoachGrounded.md must parse — guards against a syntax
    typo in the frontmatter slipping into production. Story 1.6: bumped to
    v2.0.0 (streamable two-section format with the ``<<<EVIDENCE>>>``
    sentinel between prose body and JSON evidence). Item 6: bumped to
    v2.1.0 (hedge language for `suspected: true` verdicts). adhoc2
    (2026-09-19): bumped to v2.2.0 (answer-first, word budget, one
    evidence entry per cited value)."""
    version, body = load_coach_grounded()
    assert version == "2.2.0"
    assert "AI Mix Coach" in body
    # The v2 sentinel contract must be visible in the prompt body so the
    # model emits it deterministically (and so any prompt edit that
    # accidentally drops the contract surfaces here, not in production).
    assert "<<<EVIDENCE>>>" in body
    assert load_coach_grounded_model() == "claude-sonnet-4-5"
