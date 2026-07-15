"""Constrained output contract for the holistic mastering-engineer LLM.

The LLM does NOT author a rack — it rules on the arbiter's judgment calls.
Every param it returns is re-validated by GUARD + DspOp before it touches the
chain (see llm_arbiter.apply_decisions)."""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel

Action = Literal["keep", "blend", "drop", "add_glue", "adjust"]


class ArbiterDecision(BaseModel):
    call_index: int
    action: Action
    params: dict[str, Any] | None = None
    rationale: str = ""


class ArbiterResponse(BaseModel):
    decisions: list[ArbiterDecision]
