from __future__ import annotations
from pathlib import Path
import pytest
from app.verdict_pipeline.prompt_loader import (
    SLUG_TO_FILENAME,
    SPECIALIST_SLUGS,
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


def test_all_23_specialist_slugs_present():
    assert len(SPECIALIST_SLUGS) == 23


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
    monkeypatch.setattr("app.verdict_pipeline.prompt_loader.PROMPTS_DIR", fake_dir)
    version, content = load_prompt("low_end")
    assert version == "2.0.1"
    assert "# LowEnd" in content


def test_load_unknown_slug_raises(monkeypatch, tmp_path):
    monkeypatch.setattr("app.verdict_pipeline.prompt_loader.PROMPTS_DIR", tmp_path)
    with pytest.raises(KeyError):
        load_prompt("nonexistent_slug")
