"""Coach reply payload schema (story 1.5).

The coach prompt is constrained to emit ONE JSON object on a fenced block.
This module validates the shape via Pydantic v2 so a malformed reply
cannot land as garbage on ``coach_messages.content``.
"""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CoachEvidence(BaseModel):
    """One citation chip — the label the user sees + the JSON-pointer path
    that resolves in the analysis context bundle.
    """

    model_config = ConfigDict(extra="forbid")

    label: str = Field(..., min_length=1, max_length=80)
    path: str = Field(..., min_length=1, max_length=200)


# Stable refusal-reason vocabulary. The prompt produces these strings;
# the actor passes whatever it gets through unchanged so future prompt
# revisions can introduce new reasons without a code change.
_ALLOWED_REFUSAL_REASONS = {"missing_data", "out_of_scope", "injection_attempt"}


class CoachReplyPayload(BaseModel):
    """Strict schema for the JSON object the coach prompt must emit.

    Validation rules:
    - ``kind="answer"`` → ``refusal_reason`` MUST be ``None``.
    - ``kind="refusal"`` → ``evidence`` MUST be ``[]`` AND ``refusal_reason``
      MUST be one of the allowed strings.
    """

    model_config = ConfigDict(extra="forbid")

    kind: Literal["answer", "refusal"]
    body: str = Field(..., min_length=1, max_length=8000)
    evidence: list[CoachEvidence] = Field(default_factory=list)
    refusal_reason: str | None = None

    @model_validator(mode="after")
    def _coherent(self) -> "CoachReplyPayload":
        if self.kind == "refusal":
            if self.evidence:
                raise ValueError("refusal payloads must have empty evidence")
            if self.refusal_reason not in _ALLOWED_REFUSAL_REASONS:
                raise ValueError(
                    f"refusal_reason must be one of {sorted(_ALLOWED_REFUSAL_REASONS)}"
                )
        else:  # kind == "answer"
            if self.refusal_reason is not None:
                raise ValueError("answer payloads must have refusal_reason=null")
        return self


# A *metric* claim — a number followed (optionally with a space) by a known
# audio unit. Story 1.5 code review (E-H2 + B-M2): the original `-?\d+(?:\.\d+)?`
# matched any digit and rejected ordinary prose like "Step 1" or "the 3 things",
# demoting valid coach answers to status="error" and surfacing a spurious
# "transient error" message. The unit-scoped pattern below only fires on
# measurement-shaped tokens, which is what the spec actually wants flagged.
_UNIT = r"(?:dB(?:FS|TP|SPL)?|LUFS|LU|Hz|kHz|ms|BPM|%|st)"
_NUMERIC_METRIC_RE = re.compile(rf"-?\d+(?:\.\d+)?\s*{_UNIT}\b", re.IGNORECASE)


def answer_makes_numeric_claim_without_evidence(payload: CoachReplyPayload) -> bool:
    """Heuristic: an ``answer`` whose body cites a *metric* (number+unit) but
    provides no evidence chips is rejected at the actor level — the model is
    hallucinating a measurement. Plain digits ("step 1", "3 things") don't
    trigger; only unit-suffixed tokens do. Refusals are exempt (they may say
    "you have 0 stems uploaded" legitimately).
    """
    if payload.kind != "answer":
        return False
    if payload.evidence:
        return False
    return bool(_NUMERIC_METRIC_RE.search(payload.body))
