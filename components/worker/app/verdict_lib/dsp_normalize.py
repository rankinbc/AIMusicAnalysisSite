"""Coerce model-emitted DSP ops into the schema's nested ``{type, params}``
shape. Pure (no DB / no anthropic) so it's unit-testable in isolation.

Real models routinely emit DSP params at the TOP LEVEL, e.g.
``{"type": "peaking_eq", "frequency_hz": 320, "gain_db": -3, "q": 1.4}``
instead of ``{"type": "peaking_eq", "params": {...}}``. The param NAMES
already match ``aimusic_shared.verdicts.models.DspOp`` ranges — only the
nesting differs — so a structural reshape is all that's needed.
"""
from __future__ import annotations

from typing import Any


def normalize_dsp_op(op: Any) -> Any:
    """Return ``op`` in nested ``{type, params}`` form. Idempotent:
    already-nested ops pass through unchanged (identity-preserving when no
    reshape is needed). Non-dicts and dicts without ``type`` pass through."""
    if not isinstance(op, dict) or "type" not in op:
        return op
    nested = op.get("params")
    if isinstance(nested, dict):
        stray = {k: v for k, v in op.items() if k not in ("type", "params")}
        if not stray:
            return op
        return {"type": op["type"], "params": {**nested, **stray}}
    params = {k: v for k, v in op.items() if k != "type"}
    return {"type": op["type"], "params": params}
