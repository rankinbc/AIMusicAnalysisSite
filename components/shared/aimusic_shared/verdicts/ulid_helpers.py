# components/shared/aimusic_shared/verdicts/ulid_helpers.py
from __future__ import annotations
from ulid import ULID


def new_verdict_id() -> str:
    return f"vrd_{ULID()}"


def new_fix_id() -> str:
    return f"fix_{ULID()}"


def is_verdict_id(s: str) -> bool:
    return s.startswith("vrd_") and len(s) == 30  # 4 prefix + 26 ulid


def is_fix_id(s: str) -> bool:
    return s.startswith("fix_") and len(s) == 30
