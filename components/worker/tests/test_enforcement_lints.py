"""AR39 enforcement lint: the ``anthropic`` SDK is importable ONLY from
``components/worker/app/llm/gateway.py`` (story 1.3 creates it; the lint
allows it by exact path, not existence). Budgets and metering are
inseparable from calls precisely because there is exactly one call site.

Dependency-free string scan. The SDK name appears in this file only via
concatenation; the real self-protection is the explicit ``__file__`` skip.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
COMPONENTS = REPO_ROOT / "components"

_SDK = "anth" + "ropic"
# Catches: `import X`, `from X import ...`, `import os, X`, and quoted
# dynamic forms (`__import__("X")`, `import_module("X")`).
_IMPORT_RE = re.compile(
    rf"^\s*(?:import\s+(?:[\w.,\s]*\b)?{_SDK}\b|from\s+{_SDK}\b)"
)
_DYNAMIC_RE = re.compile(rf"""["']{_SDK}["']""")

ALLOWED = COMPONENTS / "worker" / "app" / "llm" / "gateway.py"

SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "env",
    ".tox", ".nox", "site-packages", "bin", "obj", "dist", "build",
    ".pytest_cache", ".ruff_cache",
}


def test_anthropic_imports_only_in_gateway():
    scanned_roots = 0
    offenders: list[str] = []
    for component in ("worker", "shared", "analysis"):
        root = COMPONENTS / component
        if not root.exists():
            continue
        scanned_roots += 1
        for path in root.rglob("*.py"):
            if any(part in SKIP_DIRS or part.endswith(".egg-info") for part in path.parts):
                continue
            resolved = path.resolve()
            if resolved == Path(__file__).resolve() or resolved == ALLOWED:
                continue
            for lineno, line in enumerate(
                path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
            ):
                if _IMPORT_RE.match(line) or _DYNAMIC_RE.search(line):
                    offenders.append(
                        f"{path.relative_to(REPO_ROOT)}:{lineno}: {line.strip()}"
                    )
    # Fail CLOSED if the directory layout drifted — a vacuous scan must not
    # pass as "clean".
    assert scanned_roots >= 2, (
        f"enforcement lint scanned only {scanned_roots} roots under {COMPONENTS} "
        "— repo layout changed? Update this test."
    )
    assert not offenders, (
        "anthropic SDK imported outside llm/gateway.py (AR39):\n" + "\n".join(offenders)
    )
