"""`expected_prompt_version_set()` — the on-disk prompt-set gatherer stamped
onto `analyses.prompt_set_version` (v3 closeout). Mirrors the frozen v1
api's `_expected_prompt_version_set` (its verdicts router).
"""
import os

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg2://u:p@localhost/test")

from app.verdict_lib import prompt_loader  # noqa: E402


@pytest.fixture(autouse=True)
def _no_pin_lookup(monkeypatch):
    # load_prompt is pin-aware — each slug would attempt a prompt_versions DB
    # lookup (fail-open, but 26 connection attempts is not a unit test).
    monkeypatch.setattr(prompt_loader, "_resolve_pin", lambda _slug: None)


def test_expected_prompt_version_set_shape():
    s = prompt_loader.expected_prompt_version_set()

    assert s  # non-empty
    parts = s.split(",")
    # triage + one entry per specialist slug
    assert len(parts) == 1 + len(prompt_loader.SLUG_TO_FILENAME)
    assert all("@" in p for p in parts)
    assert parts[0].startswith("triage@")


def test_expected_prompt_version_set_slugs_sorted():
    s = prompt_loader.expected_prompt_version_set()
    slugs = [p.split("@", 1)[0] for p in s.split(",")[1:]]
    assert slugs == sorted(prompt_loader.SLUG_TO_FILENAME)


def test_expected_prompt_version_set_fits_column():
    # analyses.prompt_set_version is varchar(2000) (EF AddAnalysisVersionStamps).
    assert len(prompt_loader.expected_prompt_version_set()) <= 2000
