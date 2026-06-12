"""Frozen-v1 boundary check (story 1.1 AC5, AR3).

No new-stack code may import or reference the frozen v1 components:
``components/api``, ``components/frontend``, ``components/frontend-spectr``.
Story 1.2 turns this into a CI lint; it lives here so the boundary is
enforced from the moment of the relocation.

String-scan based and dependency-free on purpose. Forbidden patterns are
built by concatenation so this file never matches itself.
"""
from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
COMPONENTS = REPO_ROOT / "components"

# Built via concatenation so this test file doesn't trip its own scan.
_VP = "app." + "verdict_pipeline"
_API_PKG = "components." + "api"
_API_PATH = "components/" + "api/"
_FE_PATH = "components/" + "frontend/"
# frontend-spectr but NOT frontend-spectr-v2
_FE_SPECTR = re.compile(r"components/frontend-spectr(?!-v2)")

_IMPORT_LINE = re.compile(r"^\s*(import|from)\s+(\S+)")

SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    "bin", "obj", "dist", "build", ".pytest_cache", ".ruff_cache",
}


def _walk(root: Path, suffixes: tuple[str, ...]):
    for path in root.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix in suffixes:
            yield path


def test_no_python_imports_from_frozen_api():
    """New-stack Python never imports v1 api modules."""
    offenders: list[str] = []
    for component in ("worker", "shared", "analysis"):
        root = COMPONENTS / component
        if not root.exists():
            continue
        for path in _walk(root, (".py",)):
            if path.resolve() == Path(__file__).resolve():
                continue
            for lineno, line in enumerate(
                path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
            ):
                m = _IMPORT_LINE.match(line)
                if not m:
                    continue
                module = m.group(2)
                if module.startswith((_VP, _API_PKG)):
                    offenders.append(f"{path.relative_to(REPO_ROOT)}:{lineno}: {line.strip()}")
    assert not offenders, "frozen-v1 imports found:\n" + "\n".join(offenders)


def test_no_new_stack_path_references_into_frozen_components():
    """New-stack source files never reference frozen component paths in code.

    Markdown and docstrings may mention them historically; this scan covers
    code files only and ignores comment-only lines.
    """
    comment_prefixes = ("#", "//", "*", "/*", "--", "<!--")
    offenders: list[str] = []
    scan_targets = [
        (COMPONENTS / "worker", (".py",)),
        (COMPONENTS / "shared", (".py",)),
        (COMPONENTS / "bff" / "src", (".cs", ".csproj", ".json")),
        (COMPONENTS / "frontend-spectr-v2" / "src", (".ts", ".tsx", ".js", ".jsx", ".css")),
    ]
    for root, suffixes in scan_targets:
        if not root.exists():
            continue
        for path in _walk(root, suffixes):
            if path.resolve() == Path(__file__).resolve():
                continue
            for lineno, line in enumerate(
                path.read_text(encoding="utf-8", errors="replace").splitlines(), 1
            ):
                stripped = line.strip()
                if stripped.startswith(comment_prefixes):
                    continue
                if _API_PATH in line or _FE_PATH in line or _FE_SPECTR.search(line):
                    offenders.append(f"{path.relative_to(REPO_ROOT)}:{lineno}: {stripped}")
    assert not offenders, "frozen-v1 path references found:\n" + "\n".join(offenders)
