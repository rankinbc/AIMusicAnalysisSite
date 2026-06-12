"""Prompt-version pin resolution (story 1.1, AC3 / FR48).

A `prompt_versions` row pinning a version different from the live file's
frontmatter makes `load_prompt` serve the archived copy from
`prompts/experts/versions/{PascalName}@{version}.md` — flipped without
redeploy (TTL-cached lookup), failing open when the DB or archive is absent.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.verdict_lib import prompt_loader
from app.verdict_lib.prompt_loader import load_prompt


@pytest.fixture
def prompt_dir(tmp_path: Path, monkeypatch) -> Path:
    d = tmp_path / "experts"
    (d / "versions").mkdir(parents=True)
    (d / "LowEnd.md").write_text(
        "---\nversion: 2.0.0\n---\n# LowEnd v2\nlive body", encoding="utf-8"
    )
    (d / "versions" / "LowEnd@1.0.0.md").write_text(
        "---\nversion: 1.0.0\n---\n# LowEnd v1\narchived body", encoding="utf-8"
    )
    monkeypatch.setattr(prompt_loader, "PROMPTS_DIR", d)
    prompt_loader.clear_pin_cache()
    yield d
    prompt_loader.clear_pin_cache()


def test_no_pin_returns_live_frontmatter_version(prompt_dir, monkeypatch):
    monkeypatch.setattr(prompt_loader, "_fetch_pin_from_db", lambda slug: None)
    version, body = load_prompt("low_end")
    assert version == "2.0.0"
    assert "live body" in body


def test_pinned_version_serves_archived_file(prompt_dir, monkeypatch):
    monkeypatch.setattr(prompt_loader, "_fetch_pin_from_db", lambda slug: "1.0.0")
    version, body = load_prompt("low_end")
    assert version == "1.0.0"
    assert "archived body" in body


def test_pin_equal_to_live_version_serves_live_file(prompt_dir, monkeypatch):
    monkeypatch.setattr(prompt_loader, "_fetch_pin_from_db", lambda slug: "2.0.0")
    version, body = load_prompt("low_end")
    assert version == "2.0.0"
    assert "live body" in body


def test_missing_archive_falls_back_to_live_with_warning(
    prompt_dir, monkeypatch, caplog
):
    monkeypatch.setattr(prompt_loader, "_fetch_pin_from_db", lambda slug: "9.9.9")
    with caplog.at_level("WARNING"):
        version, body = load_prompt("low_end")
    assert version == "2.0.0"
    assert "live body" in body
    assert any("9.9.9" in r.message for r in caplog.records)


def test_db_failure_fails_open_to_live_file(prompt_dir, monkeypatch):
    def boom(slug):
        raise RuntimeError("db down")

    monkeypatch.setattr(prompt_loader, "_fetch_pin_from_db", boom)
    version, body = load_prompt("low_end")
    assert version == "2.0.0"
    assert "live body" in body


def test_pin_flip_takes_effect_after_ttl_without_restart(prompt_dir, monkeypatch):
    pins = iter([None, "1.0.0"])
    monkeypatch.setattr(prompt_loader, "_fetch_pin_from_db", lambda slug: next(pins))

    # First call caches "no pin".
    version, _ = load_prompt("low_end")
    assert version == "2.0.0"

    # Within TTL the cached value holds (iterator NOT consumed again).
    version, _ = load_prompt("low_end")
    assert version == "2.0.0"

    # Simulate TTL expiry by advancing the clock past the TTL.
    base = prompt_loader._now_monotonic()
    monkeypatch.setattr(
        prompt_loader, "_now_monotonic", lambda: base + prompt_loader.PIN_TTL_S + 1
    )
    version, body = load_prompt("low_end")
    assert version == "1.0.0"
    assert "archived body" in body


def test_unpinned_lookup_cached_within_ttl(prompt_dir, monkeypatch):
    calls = {"n": 0}

    def counting(slug):
        calls["n"] += 1
        return None

    monkeypatch.setattr(prompt_loader, "_fetch_pin_from_db", counting)
    load_prompt("low_end")
    load_prompt("low_end")
    assert calls["n"] == 1


def test_path_traversal_pin_is_ignored(prompt_dir, monkeypatch, caplog):
    # An evil .md OUTSIDE the versions dir that a traversal pin would reach.
    evil = prompt_dir.parent / "evil.md"
    evil.write_text("---\nversion: 6.6.6\n---\nevil body", encoding="utf-8")
    monkeypatch.setattr(
        prompt_loader, "_fetch_pin_from_db", lambda slug: "../../evil"
    )
    with caplog.at_level("WARNING"):
        version, body = load_prompt("low_end")
    assert version == "2.0.0"
    assert "live body" in body
    assert any("not a safe version token" in r.message for r in caplog.records)


def test_pinned_archive_rescues_missing_live_file(prompt_dir, monkeypatch):
    (prompt_dir / "LowEnd.md").unlink()
    monkeypatch.setattr(prompt_loader, "_fetch_pin_from_db", lambda slug: "1.0.0")
    version, body = load_prompt("low_end")
    assert version == "1.0.0"
    assert "archived body" in body


def test_missing_live_file_without_pin_raises(prompt_dir, monkeypatch):
    (prompt_dir / "LowEnd.md").unlink()
    monkeypatch.setattr(prompt_loader, "_fetch_pin_from_db", lambda slug: None)
    with pytest.raises(FileNotFoundError):
        load_prompt("low_end")


def test_archive_frontmatter_mismatch_warns_but_serves(prompt_dir, monkeypatch, caplog):
    (prompt_dir / "versions" / "LowEnd@3.0.0.md").write_text(
        "---\nversion: 2.9.9\n---\nmislabeled body", encoding="utf-8"
    )
    monkeypatch.setattr(prompt_loader, "_fetch_pin_from_db", lambda slug: "3.0.0")
    with caplog.at_level("WARNING"):
        version, body = load_prompt("low_end")
    assert version == "2.9.9"  # what actually ran is what gets recorded
    assert "mislabeled body" in body
    assert any("frontmatter says version" in r.message for r in caplog.records)
