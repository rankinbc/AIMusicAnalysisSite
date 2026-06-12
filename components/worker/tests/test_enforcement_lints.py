"""AR39 enforcement lint: the ``anthropic`` SDK is importable ONLY from
``components/worker/app/llm/gateway.py`` (story 1.3 creates it; the lint
allows it by path, not existence). Budgets and metering are inseparable from
calls precisely because there is exactly one call site.

Dependency-free string scan; forbidden pattern built by concatenation so this
file never matches itself (same trick as test_frozen_v1_boundary.py).
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
COMPONENTS = REPO_ROOT / "components"

_SDK = "anth" + "ropic"
_IMPORT_RE = re.compile(rf"^\s*(?:import\s+{_SDK}\b|from\s+{_SDK}\b)")

ALLOWED_SUFFIX = ("components", "worker", "app", "llm", "gateway.py")

SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    "bin", "obj", "dist", "build", ".pytest_cache", ".ruff_cache",
}


def _allowed(path: Path) -> bool:
    return path.parts[-len(ALLOWED_SUFFIX):] == ALLOWED_SUFFIX


def test_anthropic_imports_only_in_gateway():
    offenders: list[str] = []
    for component in ("worker", "shared", "analysis"):
        root = COMPONENTS / component
        if not root.exists():
            continue
        for path in root.rglob("*.py"):
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            if path.resolve() == Path(__file__).resolve() or _allowed(path):
                continue
            for lineno, line in enumerate(
                path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
            ):
                if _IMPORT_RE.match(line):
                    offenders.append(
                        f"{path.relative_to(REPO_ROOT)}:{lineno}: {line.strip()}"
                    )
    assert not offenders, (
        "anthropic SDK imported outside llm/gateway.py (AR39):\n" + "\n".join(offenders)
    )
